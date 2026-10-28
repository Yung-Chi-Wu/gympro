import { toDisplayWeight, toStorageKg } from '../weight-unit'
import type { LogType } from '../exercise-attributes'
import { daysBetween } from '../periods'
import { setWeights } from './volume'
import type { ExerciseInfo, LoggedSet } from './types'

// A lift's next session by double progression (Plotkin 2022; ACSM 2009): keep the weight and add
// reps until every set reaches the top of the range, then add the smallest step. The range is the
// user's own: the fewest reps of their heaviest sets, up to two more, set the first period they
// lift that weight and kept from period to period (planNext). The report plans with it
// (lambda/ai-worker/src/report/plan.ts) and Today aims each exercise with it (todayAim below), so
// the two can't give different numbers.

/** The periods the report reads, this one and the ones before it. A plan follows its range through them, so Today reads as many. */
export const REPORT_WINDOWS = 6

/** Which window a date falls in: 0 for this period, 1 for the one before, -1 after it. */
export function windowOfFor(periodStart: string, periodEnd: string) {
    const days = daysBetween(periodStart, periodEnd) + 1
    return (date: string) => {
        const back = daysBetween(date, periodEnd)
        return back < 0 ? -1 : Math.floor(back / days)
    }
}

/** Groups whose exercises aren't lifts */
export const NOT_LIFTS = new Set(['cardio', 'core'])
/** Log types a main lift can have: a timed hold or a cardio machine has no best set to compare */
export const STRENGTH_LOG_TYPES = new Set<LogType>(['weight_reps', 'bodyweight', 'assisted'])

/** The smallest jump on each kind of equipment, in the unit the user logs in */
export const STEP = {
    kg: { upper: 2.5, lower: 5, dumbbell: 2 },
    lb: { upper: 5, lower: 10, dumbbell: 5 },
} as const
/** A step bigger than this share of the weight is too big a jump (ACSM 2009: 2-10%), so the range goes higher first */
export const MAX_STEP_SHARE = 0.1
export const REP_SPAN = 2
export const WIDE_REP_SPAN = 4
/** Past this many reps a set is endurance work: add the weight now */
export const MAX_TOP = 15
/** The units a lower-body lift mainly trains: the ones cardio before it interferes with */
const LOWER_BODY_UNITS = new Set(['quads', 'hamstrings', 'glutes'])
/** A strength lift that mainly trains the legs; a custom exercise, by its legs or glutes category. */
export function isLowerBodyLift(e: ExerciseInfo): boolean {
    if (!STRENGTH_LOG_TYPES.has(e.logType) || NOT_LIFTS.has(e.muscleGroup)) return false
    if (!e.primaryMuscles.length) return e.muscleGroup === 'legs' || e.muscleGroup === 'glutes'
    return setWeights(e.primaryMuscles, [], e.muscleGroup).some(([unit]) => LOWER_BODY_UNITS.has(unit))
}


/** How a lift's next session goes, in the user's unit */
export interface Prescription {
    /** load: add reps, then weight; load_now: the reps are high, add the weight now; reps: a bodyweight lift; assist: less assist */
    how: 'load' | 'load_now' | 'reps' | 'assist'
    /** The heaviest working weight this period (kg), or the added weight on the body */
    weightKg: number
    /** The fewest reps at that weight, and the top of the range */
    low: number
    top: number
    /** The weight after the step (kg); for an assisted lift, the assist stays and the step is the machine's */
    nextKg: number | null
    assistKg: number | null
    /** Sets at that weight in the last session that had them */
    sets: number
    /** The weight every set reached the top at, so weightKg is the next step and not yet lifted (planNext); absent otherwise */
    fromKg?: number | null
}

/** The weight step for an exercise, in the user's unit */
export function stepOf(e: ExerciseInfo, unit: 'kg' | 'lb'): number {
    if (e.equipment === 'dumbbell') return STEP[unit].dumbbell
    return isLowerBodyLift(e) ? STEP[unit].lower : STEP[unit].upper
}
/** A weight (kg) as the user reads it, then moved to a multiple of the step */
export const display = (kg: number, unit: 'kg' | 'lb') => toDisplayWeight(kg, unit)
export const roundToStep = (value: number, step: number) => Math.max(step, Math.round(value / step) * step)
export const kgOf = (value: number, unit: 'kg' | 'lb') => toStorageKg(Math.round(value * 10) / 10, unit)

/** The next session for one exercise from this period's sets; null when it had none */
export function prescribe(e: ExerciseInfo, sets: LoggedSet[], unit: 'kg' | 'lb', windowOf: (date: string) => number): Prescription | null {
    const now = sets.filter((s) => s.exerciseId === e.id && windowOf(s.date) === 0)
    const assisted = e.logType === 'assisted'
    const counted = assisted ? now.filter((s) => s.assistKg != null) : now
    if (!counted.length) return null
    const lastSession = (at: LoggedSet[]) => {
        const byWorkout = new Map<string, number>()
        for (const s of at) byWorkout.set(s.workoutId, (byWorkout.get(s.workoutId) ?? 0) + 1)
        const latest = [...at].sort((a, b) => b.date.localeCompare(a.date) || b.loggedAt.localeCompare(a.loggedAt))[0]
        return byWorkout.get(latest.workoutId) ?? at.length
    }
    if (assisted) {
        // Less assist is stronger: the sets at the least assist
        const assist = Math.min(...counted.map((s) => s.assistKg!))
        const at = counted.filter((s) => s.assistKg === assist)
        const low = Math.min(...at.map((s) => s.reps))
        return { how: 'assist', weightKg: 0, low, top: low + REP_SPAN, nextKg: null, assistKg: assist, sets: lastSession(at) }
    }
    const weighted = counted.filter((s) => s.weightKg > 0)
    if (!weighted.length) {
        const low = Math.min(...counted.map((s) => s.reps))
        return { how: 'reps', weightKg: 0, low, top: low + REP_SPAN, nextKg: null, assistKg: null, sets: lastSession(counted) }
    }
    const weightKg = Math.max(...weighted.map((s) => s.weightKg))
    const at = weighted.filter((s) => s.weightKg === weightKg)
    const low = Math.min(...at.map((s) => s.reps))
    const step = stepOf(e, unit)
    const shown = display(weightKg, unit)
    const top = Math.min(MAX_TOP, low + (step / shown > MAX_STEP_SHARE ? WIDE_REP_SPAN : REP_SPAN))
    const nextKg = kgOf(shown + step, unit)
    return { how: low >= MAX_TOP ? 'load_now' : 'load', weightKg, low, top, nextKg, assistKg: null, sets: lastSession(at) }
}

/** A weighted lift's heaviest weight in these sets, and the reps of the latest session's sets at it, in the order logged */
export function topSession(sets: LoggedSet[]): { weightKg: number; reps: number[] } | null {
    const weighted = sets.filter((s) => s.weightKg > 0)
    if (!weighted.length) return null
    const weightKg = Math.max(...weighted.map((s) => s.weightKg))
    const at = latestSession(weighted.filter((s) => s.weightKg === weightKg))
    return { weightKg, reps: [...at].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)).map((s) => s.reps) }
}

/**
 * A weighted lift's plan after each window, by window (index 0 is this period's): the range is set
 * the first period a weight is the heaviest (prescribe) and kept while the reps climb. Once every
 * set of the latest session at that weight reaches the top, the next weight is due, at the same
 * range. A heavier weight sets a new range. A lighter one for a period (a lighter week, an off day)
 * leaves the plan as it was, and for two in a row starts it again there. Null before the lift has
 * weighted sets in the windows.
 */
export function plansThrough(e: ExerciseInfo, sets: LoggedSet[], unit: 'kg' | 'lb', windowOf: (date: string) => number): (Prescription | null)[] {
    const out: (Prescription | null)[] = Array.from({ length: REPORT_WINDOWS }, () => null)
    const next = (kg: number) => kgOf(display(kg, unit) + stepOf(e, unit), unit)
    const own = sets.filter((s) => s.exerciseId === e.id)
    let plan: Prescription | null = null
    // The weight lifted at the plan's range: the plan's own, or the one before a step that is due
    let doneKg = 0
    let lighter = 0
    for (let k = REPORT_WINDOWS - 1; k >= 0; k--) {
        const rx = prescribe(e, own, unit, (date) => (windowOf(date) === k ? 0 : 1))
        const top = topSession(own.filter((s) => windowOf(s.date) === k))
        if (rx && top && (rx.how === 'load' || rx.how === 'load_now')) {
            if (!plan || rx.weightKg > doneKg || (rx.weightKg < doneKg && ++lighter >= 2)) {
                plan = rx
                doneKg = rx.weightKg
                lighter = 0
            } else if (rx.weightKg === doneKg) {
                lighter = 0
                const held: Prescription = plan
                plan = top.reps.every((r) => r >= held.top)
                    ? { ...held, how: 'load', weightKg: next(doneKg), nextKg: next(next(doneKg)), sets: rx.sets, fromKg: doneKg }
                    : { ...held, weightKg: doneKg, nextKg: next(doneKg), sets: rx.sets, fromKg: null }
            }
        }
        out[k] = plan
    }
    return out
}

/**
 * The next session for one exercise: a weighted lift's plan as plansThrough holds it, so a period
 * that reached the top plans the next weight, not a higher range; any other lift from this period
 * alone (prescribe). Null when it had no sets this period.
 */
export function planNext(e: ExerciseInfo, sets: LoggedSet[], unit: 'kg' | 'lb', windowOf: (date: string) => number): Prescription | null {
    const now = prescribe(e, sets, unit, windowOf)
    if (!now || (now.how !== 'load' && now.how !== 'load_now')) return now
    return plansThrough(e, sets, unit, windowOf)[0] ?? now
}


// ---------- Today's aim for each exercise ----------

/** Of the newest report, what Today reads for one exercise */
export interface AimFinding {
    rule: string
    subject: string | null
    data: Record<string, unknown>
}

/**
 * load: the weight and range, as the report says it. step_up: every set reached the top since,
 * so the next step. reps: a bodyweight lift. assist / assist_down: less assist once every set
 * reaches the top. hold: the report holds the lift for pain this period. lighter: the report's
 * lighter week. reset: the report takes weight off a goal lift that stopped improving.
 */
export type AimHow = 'load' | 'step_up' | 'reps' | 'assist' | 'assist_down' | 'hold' | 'lighter' | 'reset'

export interface Aim {
    how: AimHow
    /** The weight to lift (kg), or the weight added on the body; null for reps alone or an assisted lift */
    weightKg: number | null
    assistKg: number | null
    /** The range: the fewest reps last time, up to the top; a step up starts the heavier weight at the bottom */
    low: number
    top: number | null
    /** The weight once every set reaches the top (kg) */
    nextKg: number | null
    /** The weight before a step up or a reset (kg) */
    fromKg: number | null
    /** A lighter week's sets, and the usual sets and weight */
    sets: number | null
    usualSets: number | null
    usualKg: number | null
}

const aim = (how: AimHow, fields: Partial<Omit<Aim, 'how' | 'low'>> & { low: number }): Aim => ({
    how, weightKg: null, assistKg: null, top: null, nextKg: null, fromKg: null, sets: null, usualSets: null, usualKg: null, ...fields,
})
const numberOr = (v: unknown, fallback: number | null = null) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** The sets of the latest session among these */
function latestSession(sets: LoggedSet[]): LoggedSet[] {
    if (!sets.length) return []
    const last = [...sets].sort((a, b) => b.date.localeCompare(a.date) || b.loggedAt.localeCompare(a.loggedAt))[0]
    return sets.filter((s) => s.workoutId === last.workoutId)
}

/**
 * What to aim for today on one exercise, by the report's rule. The range comes from the period the
 * newest report covers, as the report worked it out (planNext, over the same periods), and each
 * session since moves it on: every set at the top, the next step. Without that period's sets, the
 * latest session gives the range. What the report decided for this period comes first: a lift
 * held for pain, a lighter week, a goal lift taken back down. Null for an exercise that isn't a
 * lift, or not done lately.
 */
export function todayAim({ exercise: e, sets, unit, today, lastPeriod, findings }: {
    exercise: ExerciseInfo
    /** Its sets before today, from REPORT_WINDOWS periods back from lastPeriod's end (or the last few weeks) */
    sets: LoggedSet[]
    unit: 'kg' | 'lb'
    today: string
    /** The period the newest report is of: the last one that ended; null when none has */
    lastPeriod: { start: string; end: string } | null
    /** That report's findings, when it is of lastPeriod */
    findings: AimFinding[]
}): Aim | null {
    if (!STRENGTH_LOG_TYPES.has(e.logType) || NOT_LIFTS.has(e.muscleGroup)) return null
    const mine = sets.filter((s) => s.exerciseId === e.id && s.date < today)
    const since = latestSession(lastPeriod ? mine.filter((s) => s.date > lastPeriod.end) : mine)
    const fromPeriod = lastPeriod ? planNext(e, mine, unit, windowOfFor(lastPeriod.start, lastPeriod.end)) : null
    // Without the period's sets, the latest session is the range, and nothing has happened since it
    const base = fromPeriod ?? (since.length ? prescribe(e, since, unit, () => 0) : null)
    const after = fromPeriod ? since : []
    if (!base) return null

    const told = (rule: string, test: (d: Record<string, unknown>) => boolean = () => true) =>
        findings.find((f) => f.rule === rule && f.subject === e.id && test(f.data))?.data
    const lighter = told('next_session', (d) => d.how === 'deload')
    if (lighter) {
        return aim('lighter', {
            weightKg: base.how === 'load' || base.how === 'load_now' ? numberOr(lighter.weightKg) : null,
            assistKg: numberOr(lighter.assistKg), low: numberOr(lighter.low, base.low)!, sets: numberOr(lighter.sets),
            usualSets: numberOr(lighter.usualSets), usualKg: numberOr(lighter.usualKg),
        })
    }
    const hold = told('pain_hold')
    if (hold) {
        return aim('hold', {
            weightKg: base.how === 'load' || base.how === 'load_now' ? numberOr(hold.weightKg, base.weightKg) : null,
            assistKg: numberOr(hold.assistKg), low: numberOr(hold.low, base.low)!,
        })
    }

    const step = stepOf(e, unit)
    const stepUp = (kg: number) => kgOf(display(kg, unit) + step, unit)
    if (base.how === 'reps') {
        // A bodyweight lift moves its range with each session
        const rx = after.length ? prescribe(e, after, unit, () => 0) ?? base : base
        return aim('reps', { low: rx.low, top: rx.top })
    }
    if (base.how === 'assist') {
        const assisted = after.filter((s) => s.assistKg != null)
        if (!assisted.length) return aim('assist', { assistKg: base.assistKg, low: base.low, top: base.top })
        const least = Math.min(...assisted.map((s) => s.assistKg!))
        const at = assisted.filter((s) => s.assistKg === least)
        return at.every((s) => s.reps >= base.top)
            ? aim('assist_down', { assistKg: least, low: base.low, top: base.top })
            : aim('assist', { assistKg: least, low: base.low, top: base.top })
    }

    const weighted = after.filter((s) => s.weightKg > 0)
    if (!weighted.length) {
        const reset = told('goal_path', (d) => d.path === 'stalled' && typeof d.dropKg === 'number')
        if (reset) {
            const dropKg = reset.dropKg as number
            return aim('reset', { weightKg: dropKg, fromKg: base.weightKg, low: base.low, top: base.top, nextKg: stepUp(dropKg) })
        }
        // The period reached the top, so the report's plan is the next weight already
        if (base.fromKg != null) return aim('step_up', { weightKg: base.weightKg, fromKg: base.fromKg, low: base.low, top: base.top })
        return base.how === 'load_now'
            ? aim('step_up', { weightKg: base.nextKg, fromKg: base.weightKg, low: base.low, top: base.top })
            : aim('load', { weightKg: base.weightKg, low: base.low, top: base.top, nextKg: base.nextKg })
    }
    // A session since: its heaviest sets either all reached the top, or keep at it
    const heaviest = Math.max(...weighted.map((s) => s.weightKg))
    const at = weighted.filter((s) => s.weightKg === heaviest)
    return at.every((s) => s.reps >= base.top)
        ? aim('step_up', { weightKg: stepUp(heaviest), fromKg: heaviest, low: base.low, top: base.top })
        : aim('load', { weightKg: heaviest, low: base.low, top: base.top, nextKg: stepUp(heaviest) })
}
