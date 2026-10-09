import type { RoutineProposal } from './data'

// What the app tells Ronnie when the user taps a card's button: Confirm or Cancel on
// a proposal, Add to today on a recommendation. Ronnie can't see buttons, so each
// tap is written into the conversation as a message with EVENT_PREFIX (for the
// model, in English) and shown in the chat as a short line (in the user's language).

export const EVENT_PREFIX = '[App event]'

const quoted = (names: string[], zh: boolean) => names.map((n) => `「${n}」`).join(zh ? '、' : ', ')

/** 從「腿日」移除「波比跳」 / remove "Burpee" from 「腿日」 */
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
    | { kind: 'recommendation_swapped'; exerciseName: string; replacedName: string }

/** For the model. A removal keeps what the row was, so Ronnie can put it back as it was if asked. */
export function eventForModel(e: RonnieEvent): string {
    if (e.kind === 'recommendation_added') return `${EVENT_PREFIX} The user tapped Add to today: "${e.exerciseName}" is now in today's workout.`
    if (e.kind === 'recommendation_swapped') return `${EVENT_PREFIX} The user tapped Swap: "${e.replacedName}" was removed from today's workout and "${e.exerciseName}" added. Routines unchanged.`
    const what = describeProposal(e.proposal, false)
    if (e.status === 'cancelled') return `${EVENT_PREFIX} The user cancelled the proposal (${what}); routines unchanged.`
    if (e.status === 'expired') return `${EVENT_PREFIX} The proposal expired and was not applied (${what}).`
    if (!e.rows.length) return `${EVENT_PREFIX} The user confirmed the proposal (${what}), but the routines already were that way; nothing changed.`
    const was = e.proposal.change === 'remove_exercise' ? 'was ' : ''
    const rows = e.rows.map((r) => `${r.routineName}: ${was}${r.targetSets ?? '?'} x ${r.targetReps ?? '?'}, position ${r.position}`).join('; ')
    return `${EVENT_PREFIX} The user confirmed the proposal and it was applied: ${what} (${rows}).`
}

/** For the chat window: one short line under the card. */
export function eventForDisplay(e: RonnieEvent, zh: boolean): string {
    if (e.kind === 'recommendation_added') return zh ? `✓ 已把「${e.exerciseName}」加入今天的訓練` : `✓ Added "${e.exerciseName}" to today's workout`
    if (e.kind === 'recommendation_swapped') return zh ? `✓ 已把今天的「${e.replacedName}」換成「${e.exerciseName}」` : `✓ Swapped "${e.replacedName}" for "${e.exerciseName}" today`
    if (e.status === 'cancelled') return zh ? `已取消：${describeProposal(e.proposal, true)}` : `Cancelled: ${describeProposal(e.proposal, false)}`
    if (e.status === 'expired') return zh ? '提議已過期，沒有套用' : 'The proposal expired and was not applied'
    if (!e.rows.length) return zh ? '課表已經是這樣了，沒有變更' : 'Nothing to change; the routines already were that way'
    const p = e.proposal
    if (zh) return `✓ 已${describeProposal(p, true)}`
    return p.change === 'add_exercise'
        ? `✓ Added "${p.exerciseName}" to ${quoted(p.routineNames, false)} (${p.targetSets} x ${p.targetReps})`
        : `✓ Removed "${p.exerciseName}" from ${quoted(p.routineNames, false)}`
}
