import type { RoutineProposal } from './data'

// What the app tells Ronnie when the user acts on a card: Confirm or Cancel on a
// proposal, Add to today on a recommendation. Ronnie can't see the buttons, so each
// action is written into the conversation as a message marked as coming from the
// app, and shown in the chat as a short line. Ronnie's tools still read the live
// data; the event says what happened and why.

const quoted = (names: string[], zh: boolean) => names.map((n) => `「${n}」`).join(zh ? '、' : ', ')

/** 從「腿日」移除「波比跳」 / add "Face Pull" to 「推日」 (3 x 15) */
export function describeProposal(p: RoutineProposal, zh: boolean): string {
    const where = quoted(p.routineNames, zh)
    if (p.change === 'add_exercise') {
        return zh
            ? `把「${p.exerciseName}」加到${where}（${p.targetSets} 組 × ${p.targetReps} 下）`
            : `add "${p.exerciseName}" to ${where} (${p.targetSets} x ${p.targetReps})`
    }
    return zh ? `從${where}移除「${p.exerciseName}」` : `remove "${p.exerciseName}" from ${where}`
}

/** One routine row the database removed or added, as resolve_ronnie_action reports it. */
export interface ResolvedRow {
    routineName: string
    targetSets: number | null
    targetReps: number | null
    position: number
}

export type RonnieEvent =
    | { kind: 'proposal'; status: 'confirmed' | 'cancelled' | 'expired'; proposal: RoutineProposal; rows: ResolvedRow[] }
    | { kind: 'recommendation_added'; exerciseName: string }

export const EVENT_PREFIX = { zh: '[app 事件]', en: '[App event]' }

/**
 * For the model. A removal keeps what the row was ("was 3 x 10, 4th"), so if the user
 * later asks to put it back, Ronnie can propose it as it was.
 */
export function eventForModel(e: RonnieEvent, zh: boolean): string {
    const prefix = zh ? EVENT_PREFIX.zh : EVENT_PREFIX.en
    if (e.kind === 'recommendation_added') {
        return zh
            ? `${prefix} 使用者按了推薦卡片的「加入今天」：「${e.exerciseName}」已加入今天的訓練。`
            : `${prefix} The user tapped Add to today on the recommendation card: "${e.exerciseName}" is now in today's workout.`
    }
    const what = describeProposal(e.proposal, zh)
    if (e.status === 'cancelled') return zh ? `${prefix} 使用者取消了提議（${what}），課表沒有變。` : `${prefix} The user cancelled the proposal (${what}); the routines are unchanged.`
    if (e.status === 'expired') return zh ? `${prefix} 提議已過期，沒有套用（${what}）。` : `${prefix} The proposal expired and was not applied (${what}).`
    if (!e.rows.length) {
        return zh
            ? `${prefix} 使用者確認了提議（${what}），但課表已經是這樣了，沒有變更。`
            : `${prefix} The user confirmed the proposal (${what}), but the routines already were that way; nothing changed.`
    }
    const rows = e.rows
        .map((r) => zh
            ? `${r.routineName}：${e.proposal.change === 'add_exercise' ? '' : '原本 '}${r.targetSets ?? '?'} 組 × ${r.targetReps ?? '?'} 下，排第 ${r.position} 個`
            : `${r.routineName}: ${e.proposal.change === 'add_exercise' ? '' : 'was '}${r.targetSets ?? '?'} x ${r.targetReps ?? '?'}, position ${r.position}`)
        .join(zh ? '；' : '; ')
    return zh ? `${prefix} 使用者確認了提議，已套用：${what}（${rows}）。` : `${prefix} The user confirmed the proposal and it was applied: ${what} (${rows}).`
}

/**
 * The exercises an app event says were changed - only for a change that was applied
 * (a confirmed proposal, or an Add to today), not a cancelled or expired one. Reads the
 * wording eventForModel writes, so the two stay together here.
 */
export function appliedExercises(text: string): string[] {
    const applied = text.startsWith(`${EVENT_PREFIX.zh} 使用者確認了提議，已套用：`) || text.startsWith(`${EVENT_PREFIX.zh} 使用者按了推薦卡片`)
        || text.startsWith(`${EVENT_PREFIX.en} The user confirmed the proposal and it was applied:`) || text.startsWith(`${EVENT_PREFIX.en} The user tapped Add to today`)
    if (!applied) return []
    const patterns = [/移除「([^」]+)」/g, /把「([^」]+)」加到/g, /：「([^」]+)」已加入/g, /(?:remove|add) "([^"]+)"/g, /: "([^"]+)" is now in/g]
    return patterns.flatMap((p) => [...text.matchAll(p)].map((m) => m[1]))
}

/** For the chat window: one short line under the card. */
export function eventForDisplay(e: RonnieEvent, zh: boolean): string {
    if (e.kind === 'recommendation_added') return zh ? `✓ 已把「${e.exerciseName}」加入今天的訓練` : `✓ Added "${e.exerciseName}" to today's workout`
    const what = describeProposal(e.proposal, zh)
    if (e.status === 'cancelled') return zh ? `已取消：${what}` : `Cancelled: ${what}`
    if (e.status === 'expired') return zh ? `提議已過期，沒有套用` : 'The proposal expired and was not applied'
    if (!e.rows.length) return zh ? '課表已經是這樣了，沒有變更' : 'Nothing to change; the routines already were that way'
    if (zh) return `✓ 已${what}`
    const p = e.proposal
    return p.change === 'add_exercise'
        ? `✓ Added "${p.exerciseName}" to ${quoted(p.routineNames, false)} (${p.targetSets} x ${p.targetReps})`
        : `✓ Removed "${p.exerciseName}" from ${quoted(p.routineNames, false)}`
}
