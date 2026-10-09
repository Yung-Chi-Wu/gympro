import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase'
import { lastCompletedPeriod, type CycleSettings } from '../../../lib/periods'
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

interface ProfileRow {
    user_id: string
    timezone: string | null
    language: string | null
}

interface CycleRow {
    user_id: string
    cycle_length: number
    start_date: string
}

/**
 * The AI calls' health, from ai_traces: calls and failures in the past hour, and what the past
 * 24 hours cost. Logged in CloudWatch's embedded metric format, which CloudWatch turns into the
 * GymPro/AI metrics the alarms watch, with no API call or extra permission. A failure here is
 * logged, never thrown: it must not stop anyone's report.
 */
export async function publishAiMetrics(supabase: SupabaseClient): Promise<void> {
    try {
        const now = Date.now()
        const rows: { created_at: string; status: string; cost_usd: number | null }[] = []
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
                .from('ai_traces')
                .select('created_at, status, cost_usd')
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
            ErrorsLastHour: lastHour.filter((r) => r.status === 'error').length,
            CostLast24hUSD: Math.round(cost * 10_000) / 10_000,
        }))
    } catch (err) {
        console.error(`AI metrics not published: ${err instanceof Error ? err.message : String(err)}`)
    }
}

export async function handler(): Promise<void> {
    const queueUrl = process.env.SQS_QUEUE_URL
    if (!queueUrl) throw new Error('SQS_QUEUE_URL environment variable is not set')

    const supabase = await getSupabaseClient()

    const cutoff = new Date(Date.now() - TRACE_RETENTION_DAYS * 86_400_000).toISOString()
    const { error: traceError } = await supabase.from('ai_traces').delete().lt('created_at', cutoff)
    if (traceError) console.error(`Old AI traces not deleted: ${traceError.message}`)
    await publishAiMetrics(supabase)

    const [profilesResult, cyclesResult] = await Promise.all([
        supabase.from('user_profiles').select('user_id, timezone, language'),
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

    const due: { userId: string; periodStart: string; periodEnd: string; language: string }[] = []
    for (const profile of (profilesResult.data ?? []) as ProfileRow[]) {
        try {
            const period = lastCompletedPeriod(profile.timezone || 'UTC', cycles.get(profile.user_id) ?? null)
            if (period) due.push({ userId: profile.user_id, ...period, language: profile.language || 'en' })
        } catch (err) {
            // A bad time zone on one profile must not stop everyone else's reports
            console.error(`Skipping user ${profile.user_id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    if (due.length === 0) return

    // Notes written during each period travel with its report
    const { data: notes, error: notesError } = await supabase
        .from('period_notes')
        .select('user_id, period_start, note')
        .in('user_id', due.map((d) => d.userId))
    if (notesError) throw new Error(`Failed to fetch period notes: ${notesError.message}`)
    const noteFor = new Map((notes ?? []).map((n) => [`${n.user_id}|${n.period_start}`, n.note as string]))

    const { data: claimed, error: claimError } = await supabase
        .from('period_reports')
        .upsert(
            due.map((d) => ({
                user_id: d.userId,
                period_start: d.periodStart,
                status: 'pending',
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
        const message: AnalysisRequestMessage = {
            userId: d.userId,
            periodStart: d.periodStart,
            periodEnd: d.periodEnd,
            userNote: noteFor.get(`${d.userId}|${d.periodStart}`),
            language: d.language,
        }
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
        }
    }

    console.log(JSON.stringify({ event: 'scheduler_run', usersDue: due.length, claimed: claimed?.length ?? 0, queued, failed }))
    // Surface queueing failures to the Lambda Errors alarm
    if (failed > 0) throw new Error(`${failed} report(s) could not be queued`)
}
