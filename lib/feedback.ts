// What users tell the owner: feedback sent from Settings (app_feedback, migration 20261025120000),
// an exercise Ronnie asks to add for a user (source ronnie, migration 20261027140000), and why
// they reported one of Ronnie's replies (the reported flag's detail on its trace). The forms and
// the routes read them with the same rules, and the labels are here so the owner's weekly email
// (lambda/ai-worker/src/audit/digest.ts) can say them too.

/** What a user can send from Settings, in the order the form shows them: exercise is one they want added */
export const FEEDBACK_KINDS = ['bug', 'idea', 'exercise'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
export const MAX_FEEDBACK_CHARS = 2000
const MAX_USER_AGENT_CHARS = 300
/** Where feedback came from: the form in Settings, or Ronnie asking to add an exercise */
export const FEEDBACK_SOURCES = ['settings', 'ronnie'] as const
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number]
/** A user's feedback in 24 hours, from both sources: past it, more is refused */
export const MAX_FEEDBACK_PER_DAY = 10
/** Of those, the exercises Ronnie can ask to add */
export const MAX_RONNIE_REQUESTS_PER_DAY = 3
/** An exercise request's name, and what it is */
export const MAX_REQUEST_NAME_CHARS = 80
export const MAX_REQUEST_DETAIL_CHARS = 300

/**
 * The message of an exercise Ronnie asks to add: its name on the first line, as the user says it,
 * then what it is. The name is what tells two requests apart (sameRequest).
 */
export function exerciseRequestMessage(name: string, detail: string): string {
    const clean = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max)
    return [clean(name, MAX_REQUEST_NAME_CHARS), clean(detail, MAX_REQUEST_DETAIL_CHARS)].filter(Boolean).join('\n')
}

/** The line under Ronnie's reply when it asked for an exercise, written by code, never by the model */
export function exerciseRequestReceipt(name: string, zh: boolean): string {
    return zh ? `📮 已幫你回報新增動作：${name}` : `📮 Asked to add to the library: ${name}`
}

/** Whether two names are one exercise, whatever the case, spacing and punctuation */
export function sameExerciseName(a: string, b: string): boolean {
    const key = (name: string) => name.toLowerCase().replace(/[\s\-_.,()（）、，·・/]+/g, '')
    return key(a) === key(b)
}

/** Why a reply was reported, in the order the form shows them */
export const REPORT_REASONS = ['wrong_fact', 'missed_question', 'unsuitable_advice', 'wrong_change', 'too_long', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]
export const MAX_REPORT_NOTE_CHARS = 500

export const REPORT_REASON_LABELS: Record<'zh-TW' | 'en', Record<ReportReason, string>> = {
    'zh-TW': {
        wrong_fact: '數字或事實錯誤',
        missed_question: '沒回答我的問題',
        unsuitable_advice: '建議不適合我',
        wrong_change: '改錯了課表或紀錄',
        too_long: '太長或語氣不對',
        other: '其他',
    },
    en: {
        wrong_fact: 'Wrong number or fact',
        missed_question: "Didn't answer my question",
        unsuitable_advice: "Advice doesn't fit me",
        wrong_change: 'Changed my workout or routine wrongly',
        too_long: 'Too long, or the wrong tone',
        other: 'Other',
    },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface Feedback {
    kind: FeedbackKind
    message: string
    language: 'en' | 'zh-TW'
}

/** Feedback from Settings: { kind, message, language }, or null when it isn't one */
export function parseFeedback(body: unknown): Feedback | null {
    if (!isObject(body)) return null
    const kind = FEEDBACK_KINDS.find((k) => k === body.kind)
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!kind || !message || message.length > MAX_FEEDBACK_CHARS) return null
    return { kind, message, language: body.language === 'zh-TW' ? 'zh-TW' : 'en' }
}

/** A browser's user agent as kept with feedback: enough to tell an iPhone's home-screen app from a desktop browser */
export const userAgentOf = (header: string | null) => (header ? header.slice(0, MAX_USER_AGENT_CHARS) : null)

export interface Report {
    traceId: string
    reasons: ReportReason[]
    /** What the user added in their own words, or null */
    note: string | null
}

/**
 * A report of one of Ronnie's replies: { traceId, reasons?, note? }. Reasons and a note are
 * optional, so a report with neither (a window opened before the form existed) still counts;
 * a reason the form doesn't have makes it no report.
 */
export function parseReport(body: unknown): Report | null {
    if (!isObject(body) || typeof body.traceId !== 'string' || !UUID.test(body.traceId)) return null
    const raw = body.reasons ?? []
    if (!Array.isArray(raw) || raw.some((r) => !REPORT_REASONS.includes(r as ReportReason))) return null
    const reasons = REPORT_REASONS.filter((r) => raw.includes(r))
    if (body.note != null && typeof body.note !== 'string') return null
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (note.length > MAX_REPORT_NOTE_CHARS) return null
    return { traceId: body.traceId, reasons, note: note || null }
}
