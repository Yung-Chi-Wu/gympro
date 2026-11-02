import { toDisplayWeight, type WeightUnit } from './weight-unit'
import { addDays, localDate } from './periods'
import { NOT_LIFTS, STRENGTH_LOG_TYPES } from './report/progression'
import { e1rm, liftMeasure } from './report/records'
import type { LogType } from './exercise-attributes'

// 紀錄's 成就 (components/Awards.tsx): a bronze, silver and gold for each main lift and for
// keeping at it. Each is worked out from what was logged, never stored, so it can't disagree
// with the log and is never taken back: not when a set's unit differs from the one shown, nor
// when the cycle changes. A lift's is its heaviest single or the estimated 1RM of a set of up to
// 10 reps, so no one has to test a max to earn it; the rest are counts that only grow, never
// streaks: a missed day or week is never lost. No points or levels.

export const TIERS = ['bronze', 'silver', 'gold'] as const
export type Tier = (typeof TIERS)[number]

export type LiftAward = 'squat' | 'bench' | 'deadlift' | 'press'
export type AwardId = LiftAward | 'pullup' | 'stronger' | 'days' | 'weeks' | 'records'

/**
 * A lift's three marks, in the user's own unit: plates a side, the numbers a gym knows (a 20 kg
 * bar with 20 kg plates; a 45 lb bar with 45 lb plates). Squat 1-2-3 plates, deadlift 2-3-4. The
 * kg and lb marks are within 8% of each other.
 */
export const LIFT_TIERS: Record<LiftAward, Record<WeightUnit, readonly [number, number, number]>> = {
    squat: { kg: [60, 100, 140], lb: [135, 225, 315] },
    bench: { kg: [40, 60, 100], lb: [95, 135, 225] },
    deadlift: { kg: [100, 140, 180], lb: [225, 315, 405] },
    press: { kg: [30, 40, 60], lb: [65, 95, 135] },
}

/** Pull-ups in one set, without assistance */
export const PULLUP_TIERS = [1, 5, 10] as const
/** Lifts up a fifth on the user's own start with them (STRONGER_SHARE), in all */
export const STRONGER_TIERS = [1, 4, 8] as const
/** Days with a logged set, in all */
export const DAY_TIERS = [10, 50, 150] as const
/** Weeks (Monday to Sunday) with WEEK_MIN_DAYS training days or more, in all: not in a row */
export const WEEK_TIERS = [4, 12, 26] as const
/** WHO 2020: muscle-strengthening on 2 or more days a week */
export const WEEK_MIN_DAYS = 2
/** A stronger lift: its best estimated 1RM at least this share of its best in its first STRONGER_BASELINE_DAYS days */
export const STRONGER_SHARE = 1.2
export const STRONGER_BASELINE_DAYS = 14
/** The body groups a stronger lift may train: big lifts, so an isolation step can't count alone */
export const STRONGER_GROUPS = new Set(['legs', 'glutes', 'back', 'chest', 'shoulders'])
/** Epley overrates sets of more reps, so those count as this many */
export const ESTIMATE_MAX_REPS = 10
/** New bests set, in all */
export const RECORD_TIERS = [1, 10, 50] as const

/** One award's three marks, how far the user has got, and the date each mark was reached */
export interface AwardTrack {
    id: AwardId
    tiers: readonly [number, number, number]
    /** The best so far: kg or lb for a lift, reps for pull-ups, a count for the rest */
    best: number
    /** A lift's best is the estimated 1RM of a set of more than one rep */
    estimated?: boolean
    /** When each mark was reached (YYYY-MM-DD, the user's date), or null */
    reached: readonly [string | null, string | null, string | null]
}

/** The tiers a track has reached */
export const reachedTiers = (track: AwardTrack): Tier[] => TIERS.filter((_, i) => track.reached[i] !== null)

/** The next mark to reach and how far along the way to it, or null once gold is reached */
export function nextMark(track: AwardTrack): { tier: Tier; value: number; share: number } | null {
    const i = track.reached.findIndex((d) => d === null)
    if (i === -1) return null
    const from = i === 0 ? 0 : track.tiers[i - 1]
    const share = Math.max(0, Math.min(1, (track.best - from) / (track.tiers[i] - from)))
    return { tier: TIERS[i], value: track.tiers[i], share }
}

/** The mark reached last, over all tracks */
export function latestReached(tracks: AwardTrack[]): { id: AwardId; tier: Tier; date: string } | null {
    let latest: { id: AwardId; tier: Tier; date: string } | null = null
    for (const track of tracks) {
        track.reached.forEach((date, i) => {
            if (date && (!latest || date > latest.date || (date === latest.date && i > TIERS.indexOf(latest.tier)))) latest = { id: track.id, tier: TIERS[i], date }
        })
    }
    return latest
}

/**
 * The library exercises each award counts (supabase/data/exercise-attributes.json): the barbell
 * lift itself, no Smith machine, front squat or trap bar; pull-ups in any grip, never assisted.
 */
export const AWARD_EXERCISES: Record<LiftAward | 'pullup', readonly string[]> = {
    squat: ['cefb0269-3c0e-4d3d-9b53-ccd8c27cbdca'], // Barbell Back Squat
    bench: ['0f75701f-9680-43fe-ab4e-cd926fae484a'], // Barbell Bench Press
    deadlift: ['837efafb-516e-47de-899f-ee172486671a', 'bc7d003c-ecad-46d1-aeaf-ebe75163e883'], // Deadlift, Sumo Deadlift
    press: ['392382cf-432b-4f89-9162-3c5872d21880'], // Overhead Press
    pullup: ['305e4696-5b56-4c5f-96de-64650c61aa4b', 'd9481455-4292-4125-90d5-f52a83266f5b', '37a415a8-99df-43fd-b413-2c83836e9f74'], // Pull-up, Chin-up, Wide Grip Pull-up
}

/** awards_page's answer (supabase/migrations/20261102180000_awards_page_units_days.sql) */
export interface AwardsPage {
    /** [exercise id, performed at, kg, reps, assist kg, the unit it was typed in], oldest first */
    sets: [string, string, number, number, number | null, string | null][]
    exercises: { id: string; log_type: string; muscle_group: string }[]
    /** When each workout with a set was, oldest first; absent until that migration is run */
    workouts?: string[]
}

type AwardSet = { exerciseId: string; date: string; weightKg: number; reps: number; assistKg: number | null; inputUnit: WeightUnit | null }

/** How far a track has got, from its values in date order: the best, and the day each mark was first reached */
function trackOf(id: AwardId, tiers: readonly [number, number, number], points: { date: string; value: number }[]): AwardTrack {
    let best = 0
    const reached: [string | null, string | null, string | null] = [null, null, null]
    for (const p of points) {
        best = Math.max(best, p.value)
        tiers.forEach((mark, i) => { if (!reached[i] && best >= mark) reached[i] = p.date })
    }
    return { id, tiers, best, reached }
}

/** What a set is worth toward a lift's mark, in kg: a single's weight, else its estimated 1RM */
const markKg = (s: AwardSet) => (s.reps <= 1 ? s.weightKg : e1rm({ weightKg: s.weightKg, reps: Math.min(s.reps, ESTIMATE_MAX_REPS) }))

/**
 * A lift's track in the unit shown. A mark counts as reached in that unit or in the one the set was
 * typed in (either, for a set older than that), so switching units never takes a medal away.
 */
function liftTrack(id: LiftAward, sets: AwardSet[], unit: WeightUnit): AwardTrack {
    const reached: [string | null, string | null, string | null] = [null, null, null]
    let best = 0
    let estimated = false
    for (const s of sets) {
        const kg = markKg(s)
        const shown = toDisplayWeight(kg, unit)
        if (shown > best) { best = shown; estimated = s.reps > 1 }
        const units: WeightUnit[] = s.inputUnit ? [unit, s.inputUnit] : ['kg', 'lb']
        LIFT_TIERS[id][unit].forEach((_, i) => {
            if (!reached[i] && units.some((u) => toDisplayWeight(kg, u) >= LIFT_TIERS[id][u][i])) reached[i] = s.date
        })
    }
    return { id, tiers: LIFT_TIERS[id][unit], best, estimated, reached }
}

/**
 * The days each exercise set a new best, by the report's own rule (lib/report/records.ts): the
 * day's best set beats every earlier set of the exercise. A first day has nothing to beat. One a
 * day per exercise, however many sets beat it, as the report counts one per lift a week.
 */
function newBestDays(sets: AwardSet[], exercises: AwardsPage['exercises']): string[] {
    const days: string[] = []
    for (const e of exercises) {
        if (!STRENGTH_LOG_TYPES.has(e.log_type as LogType) || NOT_LIFTS.has(e.muscle_group)) continue
        const { sets: own, value } = liftMeasure({ id: e.id, logType: e.log_type as LogType }, sets)
        let earlier = -Infinity
        for (let i = 0; i < own.length;) {
            const date = own[i].date
            let day = -Infinity
            for (; i < own.length && own[i].date === date; i++) day = Math.max(day, value(own[i]))
            if (earlier !== -Infinity && day > earlier) days.push(date)
            earlier = Math.max(earlier, day)
        }
    }
    return days.sort()
}

/**
 * The day each weighted lift first got STRONGER_SHARE of the user's own start with it: the best
 * estimated 1RM of its first STRONGER_BASELINE_DAYS days. Against the user's own start, not a
 * standard, so it is as fair to a beginner, a smaller lifter or a machine as to anyone.
 */
function strongerDays(sets: AwardSet[], exercises: AwardsPage['exercises']): string[] {
    const days: string[] = []
    for (const e of exercises) {
        if (e.log_type !== 'weight_reps' || !STRONGER_GROUPS.has(e.muscle_group)) continue
        const own = sets.filter((s) => s.exerciseId === e.id && s.weightKg > 0 && s.reps >= 1)
        if (!own.length) continue
        const until = addDays(own[0].date, STRONGER_BASELINE_DAYS)
        const start = Math.max(...own.filter((s) => s.date < until).map(markKg))
        const day = own.find((s) => s.date >= until && markKg(s) >= start * STRONGER_SHARE)?.date
        if (day) days.push(day)
    }
    return days.sort()
}

/** The Monday of a date's week */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))

/** Every award's track, worked out from awards_page in the user's zone and unit */
export function awardTracks(page: AwardsPage, { timeZone, weightUnit }: { timeZone: string; weightUnit: WeightUnit }): AwardTrack[] {
    // A workout's sets share its time, so each time is turned into a date once
    const dates = new Map<string, string>()
    const dateOf = (at: string) => dates.get(at) ?? dates.set(at, localDate(timeZone, new Date(at))).get(at)!
    const sets: AwardSet[] = page.sets.map(([exerciseId, at, weightKg, reps, assistKg, inputUnit]) => ({
        exerciseId, date: dateOf(at), weightKg, reps, assistKg, inputUnit: inputUnit === 'kg' || inputUnit === 'lb' ? inputUnit : null,
    }))
    const of = (ids: readonly string[]) => sets.filter((s) => ids.includes(s.exerciseId) && s.reps >= 1)
    const count = (days: string[]) => days.map((date, i) => ({ date, value: i + 1 }))

    // Training days, and each week the day it got its WEEK_MIN_DAYS-th
    const days = [...new Set((page.workouts ?? []).map(dateOf))].sort()
    const inWeek = new Map<string, number>()
    const weeks = days.filter((d) => {
        const n = (inWeek.get(mondayOf(d)) ?? 0) + 1
        inWeek.set(mondayOf(d), n)
        return n === WEEK_MIN_DAYS
    })
    return [
        liftTrack('squat', of(AWARD_EXERCISES.squat), weightUnit),
        liftTrack('bench', of(AWARD_EXERCISES.bench), weightUnit),
        liftTrack('deadlift', of(AWARD_EXERCISES.deadlift), weightUnit),
        liftTrack('press', of(AWARD_EXERCISES.press), weightUnit),
        trackOf('pullup', PULLUP_TIERS, of(AWARD_EXERCISES.pullup).map((s) => ({ date: s.date, value: s.reps }))),
        trackOf('stronger', STRONGER_TIERS, count(strongerDays(sets, page.exercises))),
        trackOf('days', DAY_TIERS, count(days)),
        trackOf('weeks', WEEK_TIERS, count(weeks)),
        trackOf('records', RECORD_TIERS, count(newBestDays(sets, page.exercises))),
    ]
}
