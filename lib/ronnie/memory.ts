import { JOINTS } from '../exercise-attributes'
import { localDateStr } from './time'

// What Ronnie remembers about a user across conversations (design agreed with the owner,
// 2026-10-07 and 2026-10-13). Only lasting facts the user said, in fixed slots, so the count
// stays bounded without the user managing it, and a new fact on a slot replaces the old one in
// code instead of the model deciding:
//   injury     one per body part (INJURY_SITES); active, or resolved when the user says it's better
//   exercise   one per exercise; like or dislike, so "I want squats again" flips "no squats"
//   equipment  one: what they have to train with
//   schedule   one: when and how long they can train
// Not saved: how they feel today, what changed today, Ronnie's guesses, or what the profile
// already holds (the goal). Stored in ronnie_memories, which only the server reads and writes.

export const MEMORY_KINDS = ['injury', 'exercise', 'equipment', 'schedule'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** Each kind's states, the first its default: an injury heals, a preference flips, the others just hold */
export const MEMORY_STATES: Record<MemoryKind, readonly string[]> = {
    injury: ['active', 'resolved'],
    exercise: ['like', 'dislike'],
    equipment: ['active'],
    schedule: ['active'],
}

/**
 * Where an injury can be: the joints the library rates each exercise's load on (JOINTS), which
 * search and recommendations can steer around, and a few it doesn't rate, kept as notes only.
 * The migration's check lists the same.
 */
export const INJURY_SITES = [...JOINTS, 'wrist', 'hip', 'ankle', 'neck'] as const

/** A note's text is a few words; longer is cut */
export const MAX_NOTE_CHARS = 200
/**
 * Not a limit the user meets: the slots bound the count (a few body parts, one per exercise).
 * This only stops abuse, by dropping the oldest note that isn't an active injury.
 */
export const MAX_NOTES = 200
/** Exercise preferences listed in the prompt, the latest first; search and cards apply all of them */
export const MAX_EXERCISE_NOTES_SHOWN = 40

export interface MemoryNote {
    kind: MemoryKind
    /** injury: a body part (INJURY_SITES); exercise: the exercise's id; equipment and schedule: null (one each) */
    subject: string | null
    state: string
    /** What the user said, short and in their words, which Ronnie reads back */
    text: string
    /** When the note was last set (ISO), shown to Ronnie with the note */
    updatedAt: string
}

export const isMemoryKind = (s: unknown): s is MemoryKind => (MEMORY_KINDS as readonly unknown[]).includes(s)
export const isInjurySite = (s: unknown): s is (typeof INJURY_SITES)[number] => (INJURY_SITES as readonly unknown[]).includes(s)

/** Two notes are the same slot: one per body part, one per exercise, one equipment, one schedule */
export const sameSlot = (a: Pick<MemoryNote, 'kind' | 'subject'>, b: Pick<MemoryNote, 'kind' | 'subject'>) =>
    a.kind === b.kind && (a.subject ?? null) === (b.subject ?? null)

export const isDislike = (n: MemoryNote) => n.kind === 'exercise' && n.state === 'dislike'
export const isActiveInjury = (n: MemoryNote) => n.kind === 'injury' && n.state === 'active'

/** The line under Ronnie's reply when a note changed, written here, never by the model */
export function memoryReceipt(change: 'added' | 'updated' | 'forgotten', text: string, zh: boolean): string {
    if (change === 'forgotten') return zh ? `📝 已忘記：${text}` : `📝 Forgotten: ${text}`
    if (change === 'updated') return zh ? `📝 已更新：${text}` : `📝 Updated: ${text}`
    return zh ? `📝 我記住了：${text}` : `📝 Remembered: ${text}`
}

const KIND_ORDER: MemoryKind[] = ['injury', 'equipment', 'schedule', 'exercise']

/**
 * The notes as the system prompt lists them, each dated in the user's time zone. Every injury,
 * the equipment and the schedule; exercise preferences the latest first, at most
 * MAX_EXERCISE_NOTES_SHOWN. An exercise note whose exercise isn't in the user's library (a
 * deleted custom one) is left out.
 */
export function memoryLines(
    notes: MemoryNote[],
    exerciseName: (id: string) => string | null,
    timeZone: string
): string[] {
    const latestFirst = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const exercises = latestFirst.filter((n) => n.kind === 'exercise' && n.subject && exerciseName(n.subject))
    const shown = [...latestFirst.filter((n) => n.kind !== 'exercise'), ...exercises.slice(0, MAX_EXERCISE_NOTES_SHOWN)]
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.updatedAt.localeCompare(b.updatedAt))
    const lines = shown.map((n) => {
        const subject = n.kind === 'injury' ? ` (${String(n.subject).replace('_', ' ')})`
            : n.kind === 'exercise' ? ` "${exerciseName(n.subject!)}" (ID: ${n.subject!.slice(0, 8)})`
            : ''
        const state = n.kind === 'injury' || n.kind === 'exercise' ? `, ${n.state}` : ''
        return `- ${n.kind}${subject}${state}, saved ${localDateStr(new Date(n.updatedAt), timeZone)}: ${n.text}`
    })
    const hidden = exercises.length - MAX_EXERCISE_NOTES_SHOWN
    if (hidden > 0) lines.push(`- and ${hidden} older exercise preferences, which search_exercises and recommend_exercise still apply`)
    return lines
}
