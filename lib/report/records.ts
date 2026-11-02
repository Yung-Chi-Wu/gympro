import type { BestSet, ExerciseInfo, LoggedSet } from './types'

// How sets of a lift compare, and so what a new best is: the report's records
// (lambda/ai-worker/src/report/facts.ts) and 成就's new bests (lib/awards.ts) use this one rule.

/** Estimated one-rep max (Epley). */
export const e1rm = (s: { weightKg: number; reps: number }) => s.weightKg * (1 + s.reps / 30)

/** What a set needs for the rule */
export type MeasuredSet = Pick<LoggedSet, 'exerciseId' | 'weightKg' | 'reps' | 'assistKg'>

/**
 * The sets that count for a lift, and how they compare. An assisted lift counts only sets that
 * have their assist (one logged before the exercise had a log type has none) and is ordered by
 * less assist, then more reps at the same assist, as the app and Ronnie read it: reps/1000 can't
 * outweigh an assist step (at least 1 lb), so one number keeps that order. A bodyweight exercise
 * with added weight on some sets is ordered the same way by the added weight: its bodyweight sets
 * have no estimated 1RM, which read as 0 and made "up Infinity%". Only bodyweight sets: by reps.
 * A weighted lift by estimated 1RM, without its 0 kg sets, which have none either.
 */
export function liftMeasure<S extends MeasuredSet>(e: Pick<ExerciseInfo, 'id' | 'logType'>, allSets: S[]) {
    const assisted = e.logType === 'assisted'
    const own = allSets.filter((s) => s.exerciseId === e.id && (!assisted || s.assistKg != null))
    const bodyweight = !assisted && own.every((s) => s.weightKg === 0)
    const added = !assisted && !bodyweight && e.logType === 'bodyweight'
    const sets = assisted || bodyweight || added ? own : own.filter((s) => s.weightKg > 0)
    const value = (s: BestSet | MeasuredSet) =>
        assisted ? s.reps / 1000 - (s.assistKg ?? 0) : added ? s.weightKg + s.reps / 1000 : bodyweight ? s.reps : e1rm(s)
    return { sets, assisted, bodyweight, added, value }
}
