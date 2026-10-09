import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

// Every user-facing AI call leaves one row in ai_traces: what the model was given, what came
// back (tool calls and their results included), tokens, cost, time, and any error. Traces are
// how a real conversation becomes an eval case, how cost is counted per feature and user, and
// how a wrong answer is debugged. Only the service role reads or writes them (the app server
// and the Lambdas); they are kept 90 days and go with the user's account.
//
// Shared by the app (Next.js routes) and the report Lambda, so it imports nothing app-only.

export type TraceFeature = 'ronnie' | 'coach_chat' | 'coach_routine' | 'report'

/** US$ per million tokens, Anthropic first-party prices (2026-09-25). A 5-minute cache write costs 1.25x input. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
}
const CACHE_WRITE = 1.25

/** A JSON field bigger than this is stored as a marker with its start, so one huge turn can't bloat the table */
const MAX_FIELD_CHARS = 256_000

export interface Trace {
    userId: string
    feature: TraceFeature
    /** The model asked for; servedModel is the one that answered */
    model: string
    servedModel?: string | null
    status: 'ok' | 'error'
    error?: string | null
    latencyMs: number
    /** One entry per API call the request made (a Ronnie turn makes one per tool round) */
    usage: Anthropic.Usage[]
    input: unknown
    output?: unknown
    /** The code that ran: the git commit on Vercel */
    appVersion?: string | null
}

export function usageTotals(usage: Anthropic.Usage[]) {
    const sum = (k: 'input_tokens' | 'output_tokens' | 'cache_creation_input_tokens' | 'cache_read_input_tokens') =>
        usage.reduce((n, u) => n + (u[k] ?? 0), 0)
    return {
        apiCalls: usage.length,
        inputTokens: sum('input_tokens'),
        outputTokens: sum('output_tokens'),
        cacheWriteTokens: sum('cache_creation_input_tokens'),
        cacheReadTokens: sum('cache_read_input_tokens'),
    }
}

/** What the calls cost in US$, or null for a model not in the price table. Thinking is billed as output. */
export function costOf(model: string, usage: Anthropic.Usage[]): number | null {
    const price = Object.entries(PRICES).find(([id]) => model.startsWith(id))?.[1]
    if (!price) return null
    const t = usageTotals(usage)
    const dollars = t.inputTokens * price.input + t.cacheWriteTokens * price.input * CACHE_WRITE
        + t.cacheReadTokens * price.cacheRead + t.outputTokens * price.output
    return dollars / 1e6
}

function capped(value: unknown): unknown {
    if (value === undefined) return null
    const json = JSON.stringify(value)
    return json.length > MAX_FIELD_CHARS ? { truncated: true, chars: json.length, start: json.slice(0, 2000) } : value
}

/** Writes one trace. Never throws: a trace that fails to save must not break the feature it records. */
export async function recordTrace(supabase: SupabaseClient, trace: Trace): Promise<void> {
    try {
        const totals = usageTotals(trace.usage)
        const { error } = await supabase.from('ai_traces').insert({
            user_id: trace.userId,
            feature: trace.feature,
            model: trace.model,
            served_model: trace.servedModel ?? null,
            status: trace.status,
            error: trace.error ?? null,
            latency_ms: Math.round(trace.latencyMs),
            api_calls: totals.apiCalls,
            input_tokens: totals.inputTokens,
            output_tokens: totals.outputTokens,
            cache_write_tokens: totals.cacheWriteTokens,
            cache_read_tokens: totals.cacheReadTokens,
            cost_usd: costOf(trace.servedModel ?? trace.model, trace.usage),
            app_version: trace.appVersion ?? null,
            input: capped(trace.input),
            output: capped(trace.output),
        })
        if (error) console.error(`AI trace not saved (${trace.feature}): ${error.message}`)
    } catch (err) {
        console.error(`AI trace not saved (${trace.feature}):`, err)
    }
}

/** The usage an API error carries, if the code that threw attached it (see runRonnieTurn, generateNarrative). */
export function usageOfError(err: unknown): Anthropic.Usage[] {
    const usage = (err as { usage?: Anthropic.Usage | Anthropic.Usage[] } | null)?.usage
    return Array.isArray(usage) ? usage : usage ? [usage] : []
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000)
