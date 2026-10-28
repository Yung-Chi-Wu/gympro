import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase'
import { lastCompletedPeriod, type CycleSettings } from '../../../lib/periods'
import { timeZoneOf } from '../../../lib/time-zone'
import type { AnalysisRequestMessage } from './types'

// Runs every hour from EventBridge Scheduler. Each user's report is due once
// their period has ended in their own time zone, so an hourly sweep reaches
// every time zone within an hour of local midnight. It also deletes AI traces
// past their retention and publishes the AI calls' health for the alarms.
//
// Idempotent: a report row is claimed with insert-or-ignore on
// (user_id, period_start), and only rows this run created are queued. Repeated
// or overlapping runs, and periods that already have a row (completed, failed,
// or from an older manual check-in), are skipped.

const sqs = new SQSClient({})

/** AI traces hold users' messages; they are kept this long for evals and debugging (lib/ai/trace.ts) */
const TRACE_RETENTION_DAYS = 90
/** A flagged trace (ai_trace_flags: the reply check fired, a correction, a report) is kept this long, to become an eval case */
const FLAGGED_TRACE_RETENTION_DAYS = 365
/** App errors (lib/app-errors.ts) are kept as long */
const APP_ERROR_RETENTION_DAYS = 90

interface ProfileRow {
    user_id: string
    timezone: string | null
}

interface CycleRow {
    user_id: string
    cycle_length: number
    start_date: string
}

/**
 * A Ronnie turn the user stopped is traced as an error, but nothing failed, so it isn't counted
 * as one: "aborted: ..." after a change (app/api/ai/coach), and before one the abort's own
 * message, from the SDK, the request's signal or the agent loop. Only these exact messages: an
 * abort on a timeout is a failure.
 */
export const stoppedByUser = (error: string | null) =>
    /^aborted: /.test(error ?? '') || ['Request was aborted.', 'This operation was aborted', 'Aborted'].includes(error ?? '')

/**
 * The AI calls' health, from ai_traces: calls and failures in the past hour, and what the past
 * 24 hours cost. Logged in CloudWatch's embedded metric format, which CloudWatch turns into the
 * GymPro/AI metrics the alarms watch, with no API call or extra permission. A failure here is
 * logged, never thrown: it must not stop anyone's report.
 */
export async function publishAiMetrics(supabase: SupabaseClient): Promise<void> {
    try {
        const now = Date.now()
        const rows: { created_at: string; status: string; error: string | null; cost_usd: number | null }[] = []
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
                .from('ai_traces')
                .select('created_at, status, error, cost_usd')
                .gte('created_at', new Date(now - 86_400_000).toISOString())
                .range(from, from + 999)
            if (error) throw new Error(error.message)
            rows.push(...(data ?? []))
            if ((data?.length ?? 0) < 1000) break
        }
        const lastHour = rows.filter((r) => Date.parse(r.created_at) >= now - 3_600_000)
        const cost = rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0)
        console.log(JSON.stringify({
            _aws: {
                Timestamp: now,
                CloudWatchMetrics: [{
                    Namespace: 'GymPro/AI',
                    Dimensions: [[]],
                    Metrics: [
                        { Name: 'CallsLastHour', Unit: 'Count' },
                        { Name: 'ErrorsLastHour', Unit: 'Count' },
                        { Name: 'CostLast24hUSD', Unit: 'None' },
                    ],
                }],
            },
            CallsLastHour: lastHour.length,
            ErrorsLastHour: lastHour.filter((r) => r.status === 'error' && !stoppedByUser(r.error)).length,
            CostLast24hUSD: Math.round(cost * 10_000) / 10_000,
        }))
    } catch (err) {
        console.error(`AI metrics not published: ${err instanceof Error ? err.message : String(err)}`)
    }
}

/**
 * The app's own failures in the past hour, from app_errors (warnings left out), as the GymPro/App
 * metric the gympro-app-errors alarm watches, and the database's size, which gympro-database-size
 * watches: Supabase's free plan turns read-only at 500 MB (database_size_bytes, migration
 * 20261027160000). Logged in the embedded metric format like the AI metrics; each is sent on its
 * own, and a failure is logged, never thrown.
 */
export async function publishAppMetrics(supabase: SupabaseClient): Promise<void> {
    const now = Date.now()
    const metric = (name: string, unit: string, value: number) => console.log(JSON.stringify({
        _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: 'GymPro/App', Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] }] },
        [name]: value,
    }))
    try {
        const { count, error } = await supabase
            .from('app_errors')
            .select('id', { count: 'exact', head: true })
            .eq('level', 'error')
            .gte('created_at', new Date(now - 3_600_000).toISOString())
        if (error) throw new Error(error.message)
        metric('AppErrorsLastHour', 'Count', count ?? 0)
    } catch (err) {
        console.error(`App metrics not published: ${err instanceof Error ? err.message : String(err)}`)
    }
    try {
        const { data, error } = await supabase.rpc('database_size_bytes')
        if (error) throw new Error(error.message)
        metric('DatabaseMB', 'Megabytes', Math.round(Number(data) / 1_000_000))
    } catch (err) {
        console.error(`Database size not published: ${err instanceof Error ? err.message : String(err)}`)
    }
}

/**
 * Deletes what is past its retention: AI traces after 90 days, a flagged one after 365, and app
 * errors after 90. A failure is logged, never thrown: reports still go out.
 */
export async function deleteExpired(supabase: SupabaseClient, now = Date.now()): Promise<void> {
    const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString()
    const { error: traceError } = await supabase.from('ai_traces').delete().lt('created_at', daysAgo(TRACE_RETENTION_DAYS)).is('flagged_at', null)
    if (traceError) console.error(`Old AI traces not deleted: ${traceError.message}`)
    const { error: flaggedError } = await supabase.from('ai_traces').delete().lt('created_at', daysAgo(FLAGGED_TRACE_RETENTION_DAYS))
    if (flaggedError) console.error(`Old flagged AI traces not deleted: ${flaggedError.message}`)
    const { error: appErrorsError } = await supabase.from('app_errors').delete().lt('created_at', daysAgo(APP_ERROR_RETENTION_DAYS))
    if (appErrorsError) console.error(`Old app errors not deleted: ${appErrorsError.message}`)
}

export async function handler(): Promise<void> {
    const queueUrl = process.env.SQS_QUEUE_URL
    if (!queueUrl) throw new Error('SQS_QUEUE_URL environment variable is not set')

    const supabase = await getSupabaseClient()

    await deleteExpired(supabase)
    await Promise.all([publishAiMetrics(supabase), publishAppMetrics(supabase)])

    const [profilesResult, cyclesResult] = await Promise.all([
        supabase.from('user_profiles').select('user_id, timezone'),
        supabase.from('training_cycles').select('user_id, cycle_length, start_date'),
    ])
    if (profilesResult.error) throw new Error(`Failed to fetch profiles: ${profilesResult.error.message}`)
    if (cyclesResult.error) throw new Error(`Failed to fetch cycles: ${cyclesResult.error.message}`)

    const cycles = new Map<string, CycleSettings>(
        ((cyclesResult.data ?? []) as CycleRow[]).map((c) => [
            c.user_id,
            { cycleLength: c.cycle_length, startDate: c.start_date },
        ])
    )

    const due: { userId: string; periodStart: string; periodEnd: string }[] = []
    for (const profile of (profilesResult.data ?? []) as ProfileRow[]) {
        try {
            const period = lastCompletedPeriod(timeZoneOf(profile.timezone), cycles.get(profile.user_id) ?? null)
            if (period) due.push({ userId: profile.user_id, ...period })
        } catch (err) {
            // A bad time zone on one profile must not stop everyone else's reports
            console.error(`Skipping user ${profile.user_id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    if (due.length === 0) return

    // Notes written during each period are kept on its report row
    const { data: notes, error: notesError } = await supabase
        .from('period_notes')
        .select('user_id, period_start, note')
        .in('user_id', due.map((d) => d.userId))
    if (notesError) throw new Error(`Failed to fetch period notes: ${notesError.message}`)
    const noteFor = new Map((notes ?? []).map((n) => [`${n.user_id}|${n.period_start}`, n.note as string]))

    // Set here, not by the column's default, so the message carries exactly the value the row has
    const queuedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await supabase
        .from('period_reports')
        .upsert(
            due.map((d) => ({
                user_id: d.userId,
                period_start: d.periodStart,
                period_end: d.periodEnd,
                status: 'pending',
                queued_at: queuedAt,
                user_note: noteFor.get(`${d.userId}|${d.periodStart}`) ?? null,
            })),
            { onConflict: 'user_id,period_start', ignoreDuplicates: true }
        )
        .select('user_id, period_start')
    if (claimError) throw new Error(`Failed to claim report rows: ${claimError.message}`)

    let queued = 0
    let failed = 0
    for (const row of claimed ?? []) {
        const d = due.find((x) => x.userId === row.user_id && x.periodStart === row.period_start)
        if (!d) continue
        // The worker reads the period and the note from the row just claimed
        const message: AnalysisRequestMessage = { userId: d.userId, periodStart: d.periodStart, queuedAt }
        try {
            const { MessageId } = await sqs.send(
                new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) })
            )
            queued++
            console.log(`Queued report for user ${d.userId}, period ${d.periodStart} (messageId ${MessageId})`)
        } catch (err) {
            failed++
            console.error(`Failed to queue report for user ${d.userId}, period ${d.periodStart}:`, err)
            // Otherwise the row stays 'pending' forever and this period is never retried
            await supabase
                .from('period_reports')
                .update({ status: 'failed', error_message: 'Failed to queue report request.' })
                .eq('user_id', d.userId)
                .eq('period_start', d.periodStart)
                .eq('queued_at', queuedAt)
        }
    }

    console.log(JSON.stringify({ event: 'scheduler_run', usersDue: due.length, claimed: claimed?.length ?? 0, queued, failed }))
    // Surface queueing failures to the Lambda Errors alarm
    if (failed > 0) throw new Error(`${failed} report(s) could not be queued`)
}
