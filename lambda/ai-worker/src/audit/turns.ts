import { EVENT_PREFIX } from '../../../../lib/ronnie/events'

// A day of Ronnie's conversation, as the daily review reads it from ai_traces: one turn per
// trace (app/api/ai/coach writes one per message), with the user's message, every tool Ronnie
// called and what it returned, and the reply shown. A day is the user's own: Ronnie starts a new
// conversation each local day, so the review reads a day once it has ended in their time zone.

/** A Ronnie trace as the review selects it */
export interface RonnieTraceRow {
    id: string
    user_id: string
    created_at: string
    input: { language?: string; message?: string; system?: string; history?: unknown[]; editFrom?: number | null } | null
    output: { reply?: string; messages?: unknown[] } | null
}

export interface ToolCall {
    name: string
    input: unknown
    result: string
}

export interface Turn {
    traceId: string
    at: string
    /** The message typed, or the app event a button tap wrote (EVENT_PREFIX) */
    user: string
    event: boolean
    /** The chat started over before this turn: a new day, Clear, or an edit of an earlier message */
    newConversation: boolean
    edited: boolean
    toolCalls: ToolCall[]
    /** The reply as shown: Ronnie's words with the app's lines (lib/ronnie/agent.ts) */
    reply: string
    /** What Ronnie itself wrote */
    own: string
    /** What the app added: 📝 note receipts, the 📌 correction, the 📋 plan line, a card's confirmations */
    appLines: string[]
}

export interface Conversation {
    userId: string
    /** The user's local date, in their time zone */
    day: string
    timeZone: string
    language: string
    /** The system prompt of the day's last turn: Ronnie's principles, the profile and notes */
    system: string
    turns: Turn[]
    /** Every trace of the day, a turn with no reply (an error) included: all are marked read */
    traceIds: string[]
    /** The day's first turns left out for length (lastTurnsThatFit) */
    leftOut?: number
}

/** A tool result longer than this is cut: the start says what it was, and the whole would crowd out the rest of the day */
export const MAX_RESULT_CHARS = 4000

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[... ${text.length - max} more characters]` : text)

type Block = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; text?: string }
const blocksOf = (m: unknown): Block[] => {
    const content = (m as { content?: unknown } | null)?.content
    return Array.isArray(content) ? (content as Block[]) : []
}
const textOf = (content: unknown): string =>
    typeof content === 'string' ? content
        : Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
            : JSON.stringify(content ?? null)

/** The tool calls a turn made, each with its result, in order (output.messages: tool_use, then tool_result) */
export function toolCallsOf(messages: unknown[]): ToolCall[] {
    const results = new Map<string, string>()
    for (const m of messages) for (const b of blocksOf(m)) if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, textOf(b.content))
    return messages.flatMap((m) => blocksOf(m).filter((b) => b.type === 'tool_use').map((b) => ({
        name: String(b.name ?? ''),
        input: b.input ?? null,
        result: cut(b.id && results.has(b.id) ? results.get(b.id)! : '[no result]', MAX_RESULT_CHARS),
    })))
}

/** Ronnie's own words: the text of its last message that called no tool, less the 📌 correction the app appends to it */
export function ownTextOf(messages: unknown[]): string {
    const last = [...messages].reverse().find((m) => (m as { role?: string })?.role === 'assistant' && !blocksOf(m).some((b) => b.type === 'tool_use'))
    return blocksOf(last).filter((b) => b.type === 'text' && typeof b.text === 'string' && !b.text.trimStart().startsWith('📌')).map((b) => b.text!.trim()).filter(Boolean).join('\n\n')
}

/** Compared without Markdown or spacing: the app strips Markdown from Ronnie's text before showing it */
const plain = (text: string) => text.replace(/[*_`#]/g, '').replace(/\s+/g, '')

/** The paragraphs of the reply shown that Ronnie didn't write */
export function appLinesOf(reply: string, own: string): string[] {
    const mine = plain(own)
    return reply.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !(mine && mine.includes(plain(p))))
}

/** A trace as a turn, or null when it has no reply to review (the turn failed) */
export function turnOf(row: RonnieTraceRow): Turn | null {
    const reply = row.output?.reply
    if (typeof reply !== 'string' || !reply.trim()) return null
    const user = String(row.input?.message ?? '')
    const edited = row.input?.editFrom != null
    const messages = Array.isArray(row.output?.messages) ? row.output.messages : []
    const own = ownTextOf(messages)
    return {
        traceId: row.id,
        at: row.created_at,
        user,
        event: user.startsWith(EVENT_PREFIX),
        newConversation: edited || !row.input?.history?.length,
        edited,
        toolCalls: toolCallsOf(messages),
        reply,
        own,
        appLines: appLinesOf(reply, own),
    }
}

export const localDate = (instant: string | number, timeZone: string) => new Date(instant).toLocaleDateString('en-CA', { timeZone })

/**
 * The days to review, oldest first: each user's traces grouped by local day, only days that have
 * ended in the user's zone (today's conversation may go on). zoneOf gives a user's zone.
 */
export function conversationsToReview(rows: RonnieTraceRow[], zoneOf: (userId: string) => string, now = Date.now()): Conversation[] {
    const days = new Map<string, Conversation & { last: RonnieTraceRow }>()
    for (const row of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
        const timeZone = zoneOf(row.user_id)
        const day = localDate(row.created_at, timeZone)
        if (day >= localDate(now, timeZone)) continue
        const key = `${row.user_id}|${day}`
        const c = days.get(key) ?? { userId: row.user_id, day, timeZone, language: 'en', system: '', turns: [], traceIds: [], last: row }
        c.traceIds.push(row.id)
        c.last = row
        const turn = turnOf(row)
        if (turn) c.turns.push(turn)
        days.set(key, c)
    }
    return [...days.values()]
        .map(({ last, ...c }) => ({ ...c, language: last.input?.language === 'zh-TW' ? 'zh-TW' : 'en', system: String(last.input?.system ?? '') }))
        .sort((a, b) => a.day.localeCompare(b.day) || a.userId.localeCompare(b.userId))
}

const timeOf = (instant: string, timeZone: string) =>
    new Date(instant).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** A day longer than this, rendered, is reviewed from its last turns that fit (about 50k tokens) */
export const MAX_CONVERSATION_CHARS = 150_000

/** The day with as many of its last turns as fit in maxChars, saying how many earlier ones were left out */
export function lastTurnsThatFit(c: Conversation, maxChars = MAX_CONVERSATION_CHARS): Conversation {
    let from = c.turns.length
    while (from > 0 && renderConversation({ ...c, turns: c.turns.slice(from - 1) }).length <= maxChars) from--
    // A single turn longer than the limit is still read: its results are already cut (MAX_RESULT_CHARS)
    if (from === c.turns.length && from > 0) from--
    return from ? { ...c, turns: c.turns.slice(from), leftOut: from } : c
}

/** The day as the reviewer reads it: numbered turns, each with its message, tools and reply */
export function renderConversation(c: Conversation): string {
    return c.turns.map((t, i) => {
        const starts = i > 0 && t.newConversation
            ? (t.edited ? ' (the user edited an earlier message: this turn replaces what followed it)' : ' (the chat was cleared: a new conversation starts here)')
            : ''
        const user = t.event ? `App event (the user tapped a button in the app, not typed): ${t.user}` : `User: ${t.user}`
        const tools = t.toolCalls.length
            ? t.toolCalls.map((x) => `[tool ${x.name}] input: ${JSON.stringify(x.input)}\nresult:\n${x.result}`).join('\n\n')
            : '[no tool calls]'
        const app = t.appLines.length ? `\n\nShown with it, written by the app:\n${t.appLines.join('\n')}` : ''
        return `--- turn ${i + 1}, ${timeOf(t.at, c.timeZone)}${starts} ---\n${user}\n\n${tools}\n\nRonnie: ${t.own || '(nothing of its own)'}${app}`
    }).join('\n\n')
}
