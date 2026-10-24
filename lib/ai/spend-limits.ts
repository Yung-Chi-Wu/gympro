import type { TraceFeature } from './trace'

// What users' AI requests may cost (migration 20261024120000). In layers, as Stripe's rate
// limiters (Tarjan 2017) and OWASP's LLM10:2025 Unbounded Consumption ("denial of wallet") lay
// them out:
//   - one AI request at a time per user;
//   - a user's requests may cost limits.userUsd over any 24 hours;
//   - all users' together limits.allUsd, so however many accounts someone makes, the reports
//     (made on a schedule, not on request) keep room under the Anthropic Console's monthly
//     spend limit, the last wall.
// The cost is what ai_traces already records, and a slot is let go only after its request's
// trace is saved, so each request counts every one before it. When the limits themselves fail
// (the database can't be reached, the migration isn't run), the request goes through and the
// failure is reported: a broken limit must not break the app.
//
// No Next.js here, so the offline check (scripts/check-ai-spend.ts) runs it as it is;
// lib/ai/model-client.ts wires it to the database and is the only maker of model clients.

/** The features a user runs on request. The report and the daily review run on a schedule. */
export const LIMITED_FEATURES: TraceFeature[] = ['ronnie', 'coach_chat', 'coach_routine']

/** Longer than a route may run (300 s on Vercel), so a slot whose request died frees itself after it */
export const SLOT_SECONDS = 360
/** How long a request waits for the user's one before it: a stopped reply still saves what it did */
const WAIT_MS = 10_000
const RETRY_MS = 750

export interface SpendLimits {
    /** US$ one user's requests may cost over 24 hours */
    userUsd: number
    /** US$ all users' requests may cost together over 24 hours */
    allUsd: number
    /** AI_LIMITS=off: the switch for a limit that refuses what it shouldn't */
    off: boolean
}

/** The limits from the environment: AI_USER_DAILY_USD (0.5), AI_ALL_DAILY_USD (1), AI_LIMITS=off */
export function spendLimitsFrom(env: Record<string, string | undefined>): SpendLimits {
    const usd = (name: string, fallback: number) => {
        const value = Number(env[name])
        return env[name]?.trim() && Number.isFinite(value) && value >= 0 ? value : fallback
    }
    return { userUsd: usd('AI_USER_DAILY_USD', 0.5), allUsd: usd('AI_ALL_DAILY_USD', 1), off: env.AI_LIMITS?.trim() === 'off' }
}

/**
 * busy: the user's request before this one is still running; user: their own limit; all: the
 * all-users limit. resetsAt is when enough of the 24 hours' cost has aged out, if known.
 */
export interface Refusal {
    reason: 'busy' | 'user' | 'all'
    resetsAt: string | null
}

type SlotFunction = 'begin_ai_request' | 'end_ai_request'

export interface SlotDeps {
    /** The database's functions, as the service role; null when its key isn't set */
    rpc: ((fn: SlotFunction, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>) | null
    limits: SpendLimits
    /** The limits failed at this step; the request has gone ahead */
    failed: (err: unknown, step: 'begin' | 'end') => void
    /** A request was refused at the all-users limit */
    allReached: () => void
    sleep?: (ms: number) => Promise<void>
    now?: () => number
}

export type Asked = { ok: true; release: () => Promise<void> } | { ok: false; refused: Refusal }

const goAhead: Asked = { ok: true, release: async () => {} }

/** Asks for a slot for one AI request. Never throws. release lets the slot go, once, and never throws. */
export async function askForSlot(userId: string, deps: SlotDeps): Promise<Asked> {
    if (deps.limits.off) return goAhead
    const { rpc } = deps
    if (!rpc) {
        deps.failed(new Error('SUPABASE_SERVICE_ROLE_KEY is not set'), 'begin')
        return goAhead
    }
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const now = deps.now ?? Date.now
    const requestId = crypto.randomUUID()
    const deadline = now() + WAIT_MS
    try {
        for (;;) {
            const { data, error } = await rpc('begin_ai_request', {
                p_user_id: userId, p_request_id: requestId, p_features: LIMITED_FEATURES,
                p_user_usd: deps.limits.userUsd, p_all_usd: deps.limits.allUsd, p_slot_seconds: SLOT_SECONDS,
            })
            if (error) throw error
            const answer = data as { ok?: unknown; reason?: unknown; resets_at?: unknown } | null
            if (answer?.ok === true) {
                let released: Promise<void> | null = null
                const release = () => (released ??= Promise.resolve()
                    .then(() => rpc('end_ai_request', { p_user_id: userId, p_request_id: requestId }))
                    .then(({ error: endError }) => { if (endError) throw endError })
                    .catch((err: unknown) => deps.failed(err, 'end')))
                return { ok: true, release }
            }
            const reason = answer?.reason
            if (answer?.ok !== false || (reason !== 'busy' && reason !== 'user' && reason !== 'all')) {
                throw new Error(`begin_ai_request answered ${JSON.stringify(data)}`)
            }
            if (reason === 'busy' && now() + RETRY_MS < deadline) {
                await sleep(RETRY_MS)
                continue
            }
            if (reason === 'all') deps.allReached()
            return { ok: false, refused: { reason, resetsAt: typeof answer.resets_at === 'string' ? answer.resets_at : null } }
        }
    } catch (err) {
        deps.failed(err, 'begin')
        return goAhead
    }
}
