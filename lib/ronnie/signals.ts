import type { TraceFlag } from '../ai/trace'
import type { DisplayItem } from './conversation'

// What the user does after a reply that says it may have been wrong, read from today's
// conversation as the server keeps it. Each signal flags the trace of the reply it is about
// (lib/ai/trace.ts flagTrace), so the turns worth turning into eval cases are found without
// anyone reading every conversation. A flag is a lead, not a verdict: "no, I meant the other
// one" is a correction of the user's own words as often as of Ronnie's.

type Reply = Extract<DisplayItem, { kind: 'assistant' }>

/** Within this long of a reply, cancelling its card or clearing the chat says the reply missed */
export const RIGHT_AFTER_MS = 2 * 60_000

// A message that opens by saying the last reply was wrong, or says so outright. Read from the
// start of the message, where a correction comes ("不是，我是說..."), or as a phrase anywhere.
// 不是 as a correction, not 不是很累 or 不是每天
const CORRECTION_START_ZH = /^\s*(不是(?!很|太|每|特別|所有|一定)|不對|錯了|搞錯|你錯|沒有啊|我(還)?沒(有)?(做|練))/
const CORRECTION_ZH = /你(說|講|搞)錯|不是這樣|弄錯了|看錯了|算錯了/
const CORRECTION_START_EN = /^\s*(no[,.!]|nope\b|wrong\b|that's wrong|that is wrong|not right|incorrect)/i
const CORRECTION_EN = /\b(that's not right|that is not right|that's wrong|you're wrong|you are wrong|i (didn't|haven't|never) (do|did|done)\b|i haven't done)/i

/** Whether a message says the reply before it was wrong */
export function correctionIn(message: string): boolean {
    return CORRECTION_START_ZH.test(message) || CORRECTION_ZH.test(message) || CORRECTION_START_EN.test(message) || CORRECTION_EN.test(message)
}

const replies = (display: DisplayItem[]) => display.filter((d): d is Reply => d.kind === 'assistant')

/** The reply last shown, if it has a trace */
export function lastReply(display: DisplayItem[]): Reply | null {
    const last = display.at(-1)
    return last?.kind === 'assistant' && last.traceId ? last : null
}

/** The reply to the user's n-th message (0-based), the one an edit of that message replaces */
export function replyTo(display: DisplayItem[], n: number): Reply | null {
    const at = display.map((d, i) => (d.kind === 'user' ? i : -1)).filter((i) => i >= 0)[n]
    if (at === undefined) return null
    const next = display.slice(at + 1).find((d) => d.kind === 'user' || d.kind === 'assistant')
    return next?.kind === 'assistant' && next.traceId ? next : null
}

/** The reply that showed a proposal card */
export function replyWithProposal(display: DisplayItem[], actionId: string): Reply | null {
    return replies(display).find((r) => r.traceId && r.proposals?.some((p) => p.id === actionId)) ?? null
}

/** How long ago a reply was shown, or null for one saved before replies had a time */
export function sinceReply(reply: Reply, now = Date.now()): number | null {
    const at = reply.at ? Date.parse(reply.at) : NaN
    return Number.isFinite(at) ? now - at : null
}

/**
 * The flags a new message raises on what came before it: a correction of the reply just shown,
 * or an edit of an earlier message, which flags the reply it replaces.
 */
export function flagsForMessage(display: DisplayItem[], message: string, editFrom: number | null, userId: string): TraceFlag[] {
    if (editFrom != null) {
        const replaced = replyTo(display, editFrom)
        return replaced ? [{ traceId: replaced.traceId!, userId, kind: 'edit', detail: { editFrom } }] : []
    }
    const last = lastReply(display)
    return last && correctionIn(message) ? [{ traceId: last.traceId!, userId, kind: 'correction', detail: { message } }] : []
}

/** A flag on the reply just shown, when the chat is cleared right after it */
export function flagForClear(display: DisplayItem[], userId: string, now = Date.now()): TraceFlag[] {
    const last = lastReply(display)
    const since = last && sinceReply(last, now)
    return last && since != null && since <= RIGHT_AFTER_MS ? [{ traceId: last.traceId!, userId, kind: 'cleared', detail: { seconds: Math.round(since / 1000) } }] : []
}

/** A flag on the reply whose card was cancelled, when it was cancelled right after it */
export function flagForCancel(display: DisplayItem[], actionId: string, userId: string, now = Date.now()): TraceFlag[] {
    const reply = replyWithProposal(display, actionId)
    const since = reply && sinceReply(reply, now)
    return reply && since != null && since <= RIGHT_AFTER_MS ? [{ traceId: reply.traceId!, userId, kind: 'card_cancelled', detail: { seconds: Math.round(since / 1000) } }] : []
}
