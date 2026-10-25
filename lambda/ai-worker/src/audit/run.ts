import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { costOf, errorText, flagTrace, recordTrace, usageOfError } from '../../../../lib/ai/trace'
import { timeZoneOf } from '../../../../lib/time-zone'
import { AUDIT_MODEL, REQUEST_TIMEOUT_MS, reviewConversation, type Problem } from './auditor'
import { conversationsToReview, lastTurnsThatFit, type Conversation, type RonnieTraceRow } from './turns'

// One daily review: the Ronnie turns not read yet, from the past few days, grouped into each
// user's days that have ended; one model call per day; a flag on each reply with a problem; and
// the day's traces marked read. Each day is marked read only after its review is saved, so a run
// that fails or stops partway leaves the rest for the next one, and a second run reads nothing
// twice. The flags reach the owner in the weekly email (digest.ts).

/** Turns older than this are left unread: a review that was down for days doesn't catch up on all of them at once */
export const LOOKBACK_DAYS = 4
/** At most this many days a run, and no new day once this much is spent */
export const MAX_DAYS_PER_RUN = 20
export const MAX_RUN_COST_USD = 0.5
/** No new day starts with less than this left of the Lambda's time: the call's wait, and time to save */
export const KEEP_BACK_MS = REQUEST_TIMEOUT_MS + 60_000

/** .in() lists go in the URL, so long ones are sent in parts; reads are paged by the same size */
export const IN_CHUNK = 100
export const chunks = <T>(items: T[]) => Array.from({ length: Math.ceil(items.length / IN_CHUNK) }, (_, i) => items.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK))

export interface ReviewedDay {
    conversation: Conversation
    problems: Problem[]
}

export interface AuditRun {
    at: number
    reviewed: ReviewedDay[]
    /** Days the review stopped before: the run's cap or time ran out */
    later: Conversation[]
    /** Days whose review failed, read again next run */
    failed: Conversation[]
    costUsd: number
}

export interface RunDeps {
    supabase: SupabaseClient
    client: Anthropic
    now?: number
    /** What is left of the Lambda's time */
    remainingMs?: () => number
}

async function unreadTurns(supabase: SupabaseClient, now: number): Promise<RonnieTraceRow[]> {
    const rows: RonnieTraceRow[] = []
    for (let from = 0; ; from += IN_CHUNK) {
        const { data, error } = await supabase
            .from('ai_traces')
            .select('id, user_id, created_at, input, output')
            .eq('feature', 'ronnie')
            .is('audited_at', null)
            .gte('created_at', new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString())
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + IN_CHUNK - 1)
        if (error) throw new Error(`Failed to read Ronnie traces: ${error.message}`)
        rows.push(...((data ?? []) as RonnieTraceRow[]))
        if ((data?.length ?? 0) < IN_CHUNK) return rows
    }
}

export async function zonesOf(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
    const zones = new Map<string, string>()
    for (const part of chunks(userIds)) {
        const { data, error } = await supabase.from('user_profiles').select('user_id, timezone').in('user_id', part)
        if (error) throw new Error(`Failed to read time zones: ${error.message}`)
        for (const p of data ?? []) zones.set(p.user_id, timeZoneOf(p.timezone))
    }
    return zones
}

async function markRead(supabase: SupabaseClient, traceIds: string[], now: number): Promise<void> {
    for (const part of chunks(traceIds)) {
        const { error } = await supabase.from('ai_traces').update({ audited_at: new Date(now).toISOString() }).in('id', part)
        // Read again next run: its flags are kept once
        if (error) console.error(`Reviewed traces not marked read: ${error.message}`)
    }
}

/** One flag per reply: a trace keeps one flag of a kind, so its problems go in together */
async function flagProblems(supabase: SupabaseClient, c: Conversation, problems: Problem[], model: string, auditTraceId: string) {
    for (const traceId of [...new Set(problems.map((p) => p.traceId))]) {
        await flagTrace(supabase, {
            traceId, userId: c.userId, kind: 'audit',
            detail: { problems: problems.filter((p) => p.traceId === traceId).map(({ kind, summary }) => ({ kind, summary })), model, auditTraceId },
        })
    }
}

export async function runAudit({ supabase, client, now = Date.now(), remainingMs = () => Infinity }: RunDeps): Promise<AuditRun> {
    const rows = await unreadTurns(supabase, now)
    const zones = await zonesOf(supabase, [...new Set(rows.map((r) => r.user_id))])
    const days = conversationsToReview(rows, (userId) => zones.get(userId) ?? timeZoneOf(null), now)

    const run: AuditRun = { at: now, reviewed: [], later: [], failed: [], costUsd: 0 }
    for (const day of days) {
        // A day of only failed turns has nothing to review
        if (!day.turns.length) {
            await markRead(supabase, day.traceIds, now)
            continue
        }
        if (run.reviewed.length + run.failed.length >= MAX_DAYS_PER_RUN || run.costUsd >= MAX_RUN_COST_USD || remainingMs() < KEEP_BACK_MS) {
            run.later.push(day)
            continue
        }
        const read = lastTurnsThatFit(day)
        const started = Date.now()
        const auditTraceId = crypto.randomUUID()
        const traceInput = { day: day.day, timeZone: day.timeZone, traceIds: day.traceIds, leftOut: read.leftOut ?? 0 }
        try {
            const review = await reviewConversation(client, read)
            run.costUsd += costOf(review.model, [review.usage]) ?? 0
            await recordTrace(supabase, {
                id: auditTraceId, userId: day.userId, feature: 'audit', model: AUDIT_MODEL, servedModel: review.model, status: 'ok',
                latencyMs: Date.now() - started, usage: [review.usage], input: { ...traceInput, prompt: review.prompt }, output: { problems: review.problems },
            })
            await flagProblems(supabase, day, review.problems, review.model, auditTraceId)
            await markRead(supabase, day.traceIds, now)
            run.reviewed.push({ conversation: day, problems: review.problems })
        } catch (err) {
            const usage = usageOfError(err)
            run.costUsd += costOf(AUDIT_MODEL, usage) ?? 0
            await recordTrace(supabase, {
                id: auditTraceId, userId: day.userId, feature: 'audit', model: AUDIT_MODEL, status: 'error', error: errorText(err),
                latencyMs: Date.now() - started, usage, input: { ...traceInput, prompt: (err as { prompt?: string }).prompt ?? null },
            })
            console.error(`Review failed for user ${day.userId}, ${day.day}: ${errorText(err)}`)
            run.failed.push(day)
        }
    }

    console.log(JSON.stringify({
        event: 'ronnie_audit',
        days: run.reviewed.length,
        replies: run.reviewed.reduce((n, d) => n + d.conversation.turns.length, 0),
        problems: run.reviewed.reduce((n, d) => n + d.problems.length, 0),
        later: run.later.length,
        failed: run.failed.length,
        costUsd: Math.round(run.costUsd * 10_000) / 10_000,
    }))
    return run
}
