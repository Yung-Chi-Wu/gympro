'use server'

import { createClient } from '@/lib/supabase/server'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { currentPeriod, localDate, periodEndFor } from '@/lib/periods'
import { toFriendlyError } from '@/lib/friendly-error'

// Reports are queued automatically when a period ends (the report-scheduler
// Lambda). These actions cover what the user still does by hand: today's weight
// and note (or, from before day notes, a note for the period), and retrying a
// report that failed.

export interface ActionResult {
    success: boolean
    // Set on failure only; the UI has its own translated success text
    message?: string
}

const MAX_NOTE_LENGTH = 1000
// Short, so a week of day notes can't drown the rest of the report's brief (the table checks it too)
const MAX_DAY_NOTE_LENGTH = 200

// The table's own limit is looser; this only catches a typo (a missing decimal point)
const MAX_BODY_WEIGHT_KG = 400

/**
 * Save (or delete, when null) today's body weight. One weigh-in a day, like the day note:
 * saving again replaces it. Weigh-ins from before this (several on one day) stay as they are.
 */
export async function saveDayWeight(weightKg: number | null): Promise<ActionResult> {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, message: 'Not authenticated.' }
    if (weightKg !== null && !(Number.isFinite(weightKg) && weightKg > 0 && weightKg <= MAX_BODY_WEIGHT_KG)) {
        return { success: false, message: 'Enter a valid weight.' }
    }

    // Today is the user's own date, from the server's clock. A day is at most 26 hours, so
    // the last two days hold all of today's weigh-ins.
    const { data: profile } = await supabase.from('user_profiles').select('timezone').eq('user_id', user.id).maybeSingle()
    const timeZone = profile?.timezone || 'UTC'
    const today = localDate(timeZone, new Date())
    const { data: recent, error: readError } = await supabase
        .from('body_metrics')
        .select('id, recorded_at')
        .eq('user_id', user.id)
        .gte('recorded_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
        .order('recorded_at', { ascending: false })
    if (readError) return { success: false, message: toFriendlyError(readError) }
    const todays = (recent ?? []).filter((m) => localDate(timeZone, new Date(m.recorded_at)) === today).map((m) => m.id)

    // Without a row back, the database refused the change (row-level security) without an error
    const changed = (rows: unknown[] | null, expected: number): ActionResult =>
        (rows?.length ?? 0) >= expected ? { success: true } : { success: false, message: 'Could not change today\'s weight.' }

    if (weightKg === null) {
        if (!todays.length) return { success: true }
        const { data, error } = await supabase.from('body_metrics').delete().in('id', todays).select('id')
        return error ? { success: false, message: toFriendlyError(error) } : changed(data, todays.length)
    }
    if (!todays.length) {
        const { error } = await supabase.from('body_metrics').insert({
            user_id: user.id,
            weight_kg: weightKg,
            recorded_at: new Date().toISOString(),
        })
        return error ? { success: false, message: toFriendlyError(error) } : { success: true }
    }
    const [latest, ...extra] = todays
    const { data, error } = await supabase.from('body_metrics').update({ weight_kg: weightKg }).eq('id', latest).select('id')
    if (error) return { success: false, message: toFriendlyError(error) }
    const result = changed(data, 1)
    if (result.success && extra.length) await supabase.from('body_metrics').delete().in('id', extra)
    return result
}

/** Save (or delete, when empty) today's note. One note a day, on any day, trained or not. */
export async function saveDayNote(note: string): Promise<ActionResult> {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, message: 'Not authenticated.' }

    const trimmed = note.trim()
    // Counted the way the database counts: by character, not UTF-16 unit
    if ([...trimmed].length > MAX_DAY_NOTE_LENGTH) {
        return { success: false, message: `Keep the note under ${MAX_DAY_NOTE_LENGTH} characters.` }
    }

    // Today is the user's own date, from the server's clock, never from the client
    const { data: profile } = await supabase.from('user_profiles').select('timezone').eq('user_id', user.id).maybeSingle()
    const today = localDate(profile?.timezone || 'UTC', new Date())

    const { error } = trimmed
        ? await supabase
              .from('day_notes')
              .upsert(
                  { user_id: user.id, note_date: today, note: trimmed, updated_at: new Date().toISOString() },
                  { onConflict: 'user_id,note_date' }
              )
        : await supabase.from('day_notes').delete().eq('user_id', user.id).eq('note_date', today)
    return error ? { success: false, message: toFriendlyError(error) } : { success: true }
}

/** Save (or clear, when empty) the note for the period the user is in right now. */
export async function savePeriodNote(note: string): Promise<ActionResult> {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, message: 'Not authenticated.' }

    const trimmed = note.trim()
    if (trimmed.length > MAX_NOTE_LENGTH) {
        return { success: false, message: `Keep the note under ${MAX_NOTE_LENGTH} characters.` }
    }

    // The period comes from the server's clock and the user's settings, never from the client
    const [{ data: profile }, { data: cycle }] = await Promise.all([
        supabase.from('user_profiles').select('timezone').eq('user_id', user.id).maybeSingle(),
        supabase.from('training_cycles').select('cycle_length, start_date').eq('user_id', user.id).maybeSingle(),
    ])
    const period = currentPeriod(
        profile?.timezone || 'UTC',
        cycle ? { cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null
    )
    if (!period) return { success: false, message: 'Your training cycle has not started yet.' }

    const { error } = trimmed
        ? await supabase
              .from('period_notes')
              .upsert(
                  { user_id: user.id, period_start: period.periodStart, note: trimmed, updated_at: new Date().toISOString() },
                  { onConflict: 'user_id,period_start' }
              )
        : await supabase.from('period_notes').delete().eq('user_id', user.id).eq('period_start', period.periodStart)
    return error ? { success: false, message: toFriendlyError(error) } : { success: true }
}

/** Queue a failed report again. Only a report in 'failed' state can be retried. */
export async function retryFailedReport(periodStart: string): Promise<ActionResult> {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, message: 'Not authenticated.' }

    const [{ data: profile }, { data: cycle }] = await Promise.all([
        supabase.from('user_profiles').select('language').eq('user_id', user.id).maybeSingle(),
        supabase.from('training_cycles').select('cycle_length, start_date').eq('user_id', user.id).maybeSingle(),
    ])

    // Flip failed -> pending atomically, so a double click can't queue it twice
    const { data: claimed, error: claimError } = await supabase
        .from('period_reports')
        .update({ status: 'pending', error_message: null })
        .eq('user_id', user.id)
        .eq('period_start', periodStart)
        .eq('status', 'failed')
        .select('user_note')
        .maybeSingle()
    if (claimError) return { success: false, message: toFriendlyError(claimError) }
    if (!claimed) return { success: false, message: 'This report is not in a failed state.' }

    try {
        // Short-lived credentials from Vercel OIDC — no stored AWS access key.
        // AWS_REGION must be set explicitly in Vercel, or it defaults to the function's own region.
        const sqsClient = new SQSClient({
            region: process.env.AWS_REGION,
            credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN! }),
        })
        const { MessageId } = await sqsClient.send(
            new SendMessageCommand({
                QueueUrl: process.env.SQS_QUEUE_URL,
                MessageBody: JSON.stringify({
                    userId: user.id,
                    periodStart,
                    periodEnd: periodEndFor(
                        periodStart,
                        cycle ? { cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null
                    ),
                    userNote: claimed.user_note ?? undefined,
                    language: profile?.language || 'en',
                }),
            })
        )
        // The worker Lambda logs the same messageId, so this report can be traced in CloudWatch.
        console.log(`Re-queued report for user ${user.id}, period ${periodStart} (messageId ${MessageId})`)
    } catch (err) {
        console.error(`Failed to re-queue report for user ${user.id}, period ${periodStart}:`, err)
        await supabase
            .from('period_reports')
            .update({ status: 'failed', error_message: 'Failed to queue report request.' })
            .eq('user_id', user.id)
            .eq('period_start', periodStart)
        return { success: false, message: 'Failed to queue your report. Please try again.' }
    }

    return { success: true }
}
