import type { FlagKind } from '../../../../lib/ai/trace'
import type { Problem, ProblemKind } from './auditor'
import { localDate, type Conversation } from './turns'

// The one email a review sends the owner: each reply worth a look, with what the reviewer found
// and what the user did around it (ai_trace_flags), and the trace ids to open them by. Sent only
// when there is something to look at. It never quotes the conversation: the email leaves the
// database, and the trace is a query away.

export interface ReviewedDay {
    conversation: Conversation
    problems: Problem[]
    /** What the user did around these replies, flagged as it happened (lib/ronnie/signals.ts) */
    flags: { traceId: string; kind: FlagKind }[]
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

export interface Digest {
    subject: string
    message: string
}

const PROBLEM_LABEL: Record<ProblemKind, string> = {
    ungrounded: '沒有根據',
    false_action: '說做了但沒做',
    wrong_action: '做錯了動作',
    missed_request: '沒回應要求',
    unsafe: '安全問題',
    other: '其他錯誤',
}

const FLAG_LABEL: Record<FlagKind, string> = {
    reply_check: 'App 的檢查已更正草稿',
    correction: '使用者說回覆錯了',
    edit: '使用者改了訊息重問',
    card_cancelled: '卡片兩分鐘內就取消',
    cleared: '兩分鐘內就清除對話',
    reported: '使用者回報錯誤',
    audit: '每日檢查',
}

const timeOf = (instant: string, timeZone: string) =>
    new Date(instant).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** The email for a run, or null when no reply has a problem or a flag */
export function digestOf(run: AuditRun): Digest | null {
    const ids: string[] = []
    const sections = run.reviewed.flatMap(({ conversation: c, problems, flags }) => {
        const lines = c.turns.flatMap((t, i) => {
            const found = problems.filter((p) => p.traceId === t.traceId).map((p) => `    檢查｜${PROBLEM_LABEL[p.kind]}：${p.summary}`)
            const did = flags.filter((f) => f.traceId === t.traceId && f.kind !== 'audit').map((f) => `    使用者｜${FLAG_LABEL[f.kind]}`)
            if (!found.length && !did.length) return []
            ids.push(t.traceId)
            return [`  第 ${i + 1} 則，${timeOf(t.at, c.timeZone)}`, ...found, ...did, `    trace ${t.traceId}`]
        })
        return lines.length ? [`使用者 ${c.userId.slice(0, 8)}，${c.day}（${c.timeZone}），${c.turns.length} 則回覆`, ...lines] : []
    })
    if (!ids.length) return null

    const replies = run.reviewed.reduce((n, d) => n + d.conversation.turns.length, 0)
    const date = localDate(run.at, 'UTC')
    const notes = [
        run.later.length ? `另有 ${run.later.length} 段對話這次沒讀到（每次的上限），明天再讀。` : '',
        run.failed.length ? `${run.failed.length} 段對話檢查失敗，明天再試；原因在 /aws/lambda/gympro-ronnie-audit 的日誌。` : '',
    ].filter(Boolean)
    const message = [
        `Ronnie 每日檢查：讀了 ${run.reviewed.length} 段對話、${replies} 則回覆，${ids.length} 則要看。`,
        `（${date} 執行，花費 US$${run.costUsd.toFixed(2)}）`,
        '',
        ...sections,
        ...(notes.length ? ['', ...notes] : []),
        '',
        '看完整對話：在 Supabase SQL Editor 執行',
        `select id, created_at, input, output from ai_traces where id in (${ids.map((id) => `'${id}'`).join(', ')}) order by created_at;`,
    ].join('\n')
    // SNS subjects are plain ASCII, one line, under 100 characters
    return { subject: `GymPro Ronnie review: ${ids.length} ${ids.length === 1 ? 'reply' : 'replies'} to look at (${date})`, message }
}
