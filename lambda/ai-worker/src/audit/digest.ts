import type { SupabaseClient } from '@supabase/supabase-js'
import zh from '../../../../messages/zh-TW.json'
import { FEEDBACK_KINDS, REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '../../../../lib/feedback'
import type { FlagKind } from '../../../../lib/ai/trace'
import { timeZoneOf } from '../../../../lib/time-zone'
import type { ProblemKind } from './auditor'
import { chunks, IN_CHUNK, zonesOf } from './run'

// The owner's weekly email, Monday morning on its own schedule: what users sent from Settings in
// the past 7 days, in their own words, and the Ronnie replies flagged in them, by the daily review
// (run.ts) or by what the user did, with the reasons a user gave for reporting one. It is read
// from the database, so a day the review failed doesn't lose its week, and goes out only when
// there is something to read. It never quotes a conversation: the trace is a query away. What
// users wrote is set off line by line with "> ", so none of it reads as the email's own words,
// such as a query to run.

export const WEEK_MS = 7 * 86_400_000
/** SNS takes 256 KB; what doesn't fit is counted, with the query that lists it */
export const MAX_MESSAGE_BYTES = 200_000

export interface Digest {
    subject: string
    message: string
}

export interface WeekFlag {
    traceId: string
    userId: string
    kind: FlagKind
    detail: Record<string, unknown> | null
}

export interface WeekFeedback {
    createdAt: string
    userId: string
    kind: string
    message: string
    language: string | null
    appVersion: string | null
}

export interface Week {
    since: number
    now: number
    flags: WeekFlag[]
    /** When each flagged reply was written */
    replyTimes: Map<string, string>
    zones: Map<string, string>
    feedback: WeekFeedback[]
    /** The daily review's runs this week: conversation days read, failed, and what they cost */
    reviews: { days: number; failed: number; costUsd: number }
}

const PROBLEM_LABEL: Record<ProblemKind, string> = {
    ungrounded: '沒有根據',
    false_action: '說做了但沒做',
    wrong_action: '做錯了動作',
    missed_request: '沒回應要求',
    unsafe: '安全問題',
    other: '其他錯誤',
}

// The review's own flag is its problems, listed apart
const FLAG_LABEL: Record<Exclude<FlagKind, 'audit'>, string> = {
    reply_check: 'App｜回覆前的檢查已更正草稿',
    correction: '使用者｜說回覆錯了',
    edit: '使用者｜改了訊息重問',
    card_cancelled: '使用者｜卡片兩分鐘內就取消',
    cleared: '使用者｜兩分鐘內就清除對話',
    reported: '使用者｜回報錯誤',
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Every row of a query, a page at a time */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
    const rows: T[] = []
    for (let from = 0; ; from += IN_CHUNK) {
        const { data, error } = await page(from, from + IN_CHUNK - 1)
        if (error) throw new Error(`Failed to read ${what}: ${error.message}`)
        rows.push(...((data ?? []) as T[]))
        if ((data?.length ?? 0) < IN_CHUNK) return rows
    }
}

/** The week before `now`: its flags, feedback and reviews, and when and where each was written */
export async function readDigestWeek(supabase: SupabaseClient, now: number): Promise<Week> {
    const since = now - WEEK_MS
    const [from, to] = [new Date(since).toISOString(), new Date(now).toISOString()]
    const [flagRows, feedbackRows, reviewRows] = await Promise.all([
        allRows<{ trace_id: string; user_id: string; kind: FlagKind; detail: unknown }>((a, b) => supabase
            .from('ai_trace_flags').select('trace_id, user_id, kind, detail')
            .gte('created_at', from).lt('created_at', to).order('created_at').order('id').range(a, b), 'flags'),
        allRows<{ created_at: string; user_id: string; kind: string; message: string; language: string | null; app_version: string | null }>((a, b) => supabase
            .from('app_feedback').select('created_at, user_id, kind, message, language, app_version')
            .gte('created_at', from).lt('created_at', to).order('created_at').order('id').range(a, b), 'feedback'),
        allRows<{ status: string; cost_usd: number | string | null }>((a, b) => supabase
            .from('ai_traces').select('status, cost_usd').eq('feature', 'audit')
            .gte('created_at', from).lt('created_at', to).order('created_at').order('id').range(a, b), 'reviews'),
    ])

    // Only when each flagged reply was written: never what it said
    const replyTimes = new Map<string, string>()
    for (const part of chunks([...new Set(flagRows.map((f) => f.trace_id))])) {
        const { data, error } = await supabase.from('ai_traces').select('id, created_at').in('id', part)
        if (error) throw new Error(`Failed to read reply times: ${error.message}`)
        for (const t of data ?? []) replyTimes.set(t.id, t.created_at)
    }
    const zones = await zonesOf(supabase, [...new Set([...flagRows, ...feedbackRows].map((r) => r.user_id))])

    return {
        since,
        now,
        flags: flagRows.map((f) => ({ traceId: f.trace_id, userId: f.user_id, kind: f.kind, detail: isObject(f.detail) ? f.detail : null })),
        replyTimes,
        zones,
        feedback: feedbackRows.map((f) => ({ createdAt: f.created_at, userId: f.user_id, kind: f.kind, message: f.message, language: f.language, appVersion: f.app_version })),
        reviews: {
            days: reviewRows.length,
            failed: reviewRows.filter((r) => r.status !== 'ok').length,
            costUsd: reviewRows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0),
        },
    }
}

/** MM/DD HH:mm in a time zone */
function timeIn(instant: string, timeZone: string): string {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]))
    return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

/**
 * What a user wrote, a line at a time after "> ". Control characters and the ones that turn
 * text around (bidi overrides) are dropped, so a line can't pass for one of the email's own.
 */
export function quoted(text: string, indent: string): string[] {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '')
        .trim()
        .split('\n')
        .map((line) => `${indent}> ${line}`)
}

const shortId = (userId: string) => userId.slice(0, 8)
const bytes = (lines: string[]) => Buffer.byteLength(lines.join('\n'), 'utf8') + 1

/** One reply's flags: the review's problems, then what the app and the user did, with why they reported it */
function replyLines(flags: WeekFlag[]): string[] {
    const lines: string[] = []
    for (const f of flags.filter((f) => f.kind === 'audit')) {
        const problems = Array.isArray(f.detail?.problems) ? f.detail.problems : []
        for (const p of problems) {
            if (!isObject(p) || typeof p.summary !== 'string') continue
            lines.push(`    檢查｜${PROBLEM_LABEL[p.kind as ProblemKind] ?? PROBLEM_LABEL.other}：${p.summary.replace(/\s+/g, ' ').trim()}`)
        }
    }
    for (const f of flags) {
        if (f.kind === 'audit' || !(f.kind in FLAG_LABEL)) continue
        if (f.kind !== 'reported') {
            lines.push(`    ${FLAG_LABEL[f.kind]}`)
            continue
        }
        const picked = Array.isArray(f.detail?.reasons) ? f.detail.reasons : []
        const reasons = REPORT_REASONS.filter((r) => picked.includes(r)).map((r: ReportReason) => REPORT_REASON_LABELS['zh-TW'][r])
        lines.push(`    ${FLAG_LABEL.reported}${reasons.length ? `：${reasons.join('、')}` : ''}`)
        if (typeof f.detail?.note === 'string' && f.detail.note.trim()) lines.push(...quoted(f.detail.note, '      '))
    }
    return lines
}

/** The email for a week, or null when no one sent feedback and no reply was flagged */
export function weeklyDigestOf(week: Week): Digest | null {
    const zoneOf = (userId: string) => week.zones.get(userId) ?? timeZoneOf(null)
    const sinceIso = new Date(week.since).toISOString()

    // Feedback, oldest first
    const feedback = week.feedback.map((f) => {
        const kind = FEEDBACK_KINDS.find((k) => k === f.kind)
        const about = [`使用者 ${shortId(f.userId)}`, kind ? zh.settings.feedback.kinds[kind] : f.kind, f.language, f.appVersion && `版本 ${f.appVersion.slice(0, 7)}`]
        return [`  ${timeIn(f.createdAt, zoneOf(f.userId))}（${zoneOf(f.userId)}）${about.filter(Boolean).join('・')}`, ...quoted(f.message, '    ')]
    })

    // Flagged replies, by user, each in the order it was written
    const byTrace = new Map<string, WeekFlag[]>()
    for (const f of week.flags) byTrace.set(f.traceId, [...(byTrace.get(f.traceId) ?? []), f])
    const replies = [...byTrace.entries()]
        .map(([traceId, flags]) => ({ traceId, userId: flags[0].userId, at: week.replyTimes.get(traceId) ?? '', lines: replyLines(flags) }))
        .filter((r) => r.lines.length)
        .sort((a, b) => a.userId.localeCompare(b.userId) || a.at.localeCompare(b.at))

    if (!feedback.length && !replies.length) return null

    // As much as fits, feedback first
    let budget = MAX_MESSAGE_BYTES
    const fit = <T>(blocks: T[], linesOf: (b: T) => string[]) => {
        const shown: T[] = []
        for (const b of blocks) {
            const size = bytes(linesOf(b))
            if (size > budget) break
            budget -= size
            shown.push(b)
        }
        return shown
    }
    const shownFeedback = fit(feedback, (b) => b)
    const shownReplies = fit(replies, (r) => r.lines)

    const replyBlocks: string[] = []
    let user = ''
    for (const r of shownReplies) {
        if (r.userId !== user) {
            user = r.userId
            replyBlocks.push(`使用者 ${shortId(r.userId)}（${zoneOf(r.userId)}）`)
        }
        replyBlocks.push(`  ${r.at ? timeIn(r.at, zoneOf(r.userId)) : '時間不明'}`, ...r.lines, `    trace ${r.traceId}`)
    }

    const { days, failed, costUsd } = week.reviews
    const date = new Date(week.now).toISOString().slice(0, 10)
    const message = [
        `GymPro 每週整理：${sinceIso.slice(0, 10)} 到 ${date}（UTC）`,
        `意見回饋 ${feedback.length} 則，Ronnie 的回覆 ${replies.length} 則要看。`,
        `每日檢查這週讀了 ${days} 段對話${failed ? `（${failed} 段失敗，原因在 /aws/lambda/gympro-ronnie-audit 的日誌）` : ''}，花費 US$${costUsd.toFixed(2)}。`,
        '使用者寫的字每行以「> 」開頭。',
        ...(feedback.length ? [
            '',
            `—— 意見回饋（${feedback.length} 則）——`,
            ...shownFeedback.flat(),
            ...(shownFeedback.length < feedback.length ? [
                `  還有 ${feedback.length - shownFeedback.length} 則放不下，在 Supabase SQL Editor 執行：`,
                `  select created_at, user_id, kind, message from app_feedback where created_at >= '${sinceIso}' order by created_at;`,
            ] : []),
        ] : []),
        ...(replies.length ? [
            '',
            `—— Ronnie（${replies.length} 則回覆）——`,
            ...replyBlocks,
            ...(shownReplies.length < replies.length ? [
                `還有 ${replies.length - shownReplies.length} 則放不下，在 Supabase SQL Editor 執行：`,
                `select trace_id, kind, detail from ai_trace_flags where created_at >= '${sinceIso}' order by created_at;`,
            ] : []),
            ...(shownReplies.length ? [
                '',
                '看完整對話：在 Supabase SQL Editor 執行',
                `select id, created_at, input, output from ai_traces where id in (${shownReplies.map((r) => `'${r.traceId}'`).join(', ')}) order by created_at;`,
            ] : []),
        ] : []),
    ].join('\n')

    // SNS subjects are plain ASCII, one line, under 100 characters
    const replyWord = replies.length === 1 ? 'reply' : 'replies'
    return { subject: `GymPro weekly: ${feedback.length} feedback, ${replies.length} ${replyWord} to look at (${date})`, message }
}

/** Reads the week and sends its email, if there is anything in it */
export async function runWeeklyDigest({ supabase, publish, now = Date.now() }: {
    supabase: SupabaseClient
    publish: (digest: Digest) => Promise<void>
    now?: number
}): Promise<{ emailed: boolean }> {
    const week = await readDigestWeek(supabase, now)
    const digest = weeklyDigestOf(week)
    if (digest) await publish(digest)
    console.log(JSON.stringify({
        event: 'weekly_digest',
        feedback: week.feedback.length,
        flags: week.flags.length,
        reviews: week.reviews.days,
        emailed: !!digest,
    }))
    return { emailed: !!digest }
}
