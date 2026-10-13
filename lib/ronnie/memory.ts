import { JOINTS, type Joint } from '../exercise-attributes'

// What Ronnie remembers about a user across conversations (design agreed with the owner,
// 2026-10-07 and 2026-10-13). Only lasting facts the user said, in fixed slots, so the count
// stays bounded without the user managing it, and a new fact on a slot replaces the old one in
// code instead of the model deciding:
//   injury     one per joint (JOINTS); active, or resolved when the user says it's better
//   exercise   one per exercise; like or dislike, so "I want squats again" flips "no squats"
//   equipment  one: what they have to train with
//   schedule   one: when and how long they can train
// Not saved: how they feel today, what changed today, Ronnie's guesses, or what the profile
// already holds (the goal).

export const MEMORY_KINDS = ['injury', 'exercise', 'equipment', 'schedule'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

/** Each kind's states: an injury heals, a preference flips, the others just hold */
export const MEMORY_STATES: Record<MemoryKind, readonly string[]> = {
    injury: ['active', 'resolved'],
    exercise: ['like', 'dislike'],
    equipment: ['active'],
    schedule: ['active'],
}

export interface MemoryNote {
    kind: MemoryKind
    /** injury: a joint; exercise: the exercise's id; equipment and schedule: null (one each) */
    subject: string | null
    state: string
    /** What the user said, short and in their words, which Ronnie reads back */
    text: string
    /** When the note was last set (ISO), shown to Ronnie with the note */
    updatedAt: string
}

export const isJoint = (s: string): s is Joint => (JOINTS as readonly string[]).includes(s)

/** Two notes are the same slot: one per joint, one per exercise, one equipment, one schedule */
export const sameSlot = (a: Pick<MemoryNote, 'kind' | 'subject'>, b: Pick<MemoryNote, 'kind' | 'subject'>) =>
    a.kind === b.kind && (a.subject ?? null) === (b.subject ?? null)
