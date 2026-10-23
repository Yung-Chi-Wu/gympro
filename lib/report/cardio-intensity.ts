// A cardio set's intensity from its average heart rate, as a share of the user's estimated
// maximum. Objective data only (owner, 2026-10-23): a set without a heart rate, or a user without
// a birth date, is not rated. Shared by the report worker and the report view.

/** Estimated maximum heart rate for an age, in bpm: 208 − 0.7 × age (Tanaka 2001, 351 studies) */
export const maxHeartRate = (age: number) => Math.round(208 - 0.7 * age)

/**
 * ACSM's classes by percent of maximum heart rate (Garber 2011): moderate 64–76%, vigorous 77–95%.
 * Below 64% is light, which the weekly guidelines don't count; above 95% is still vigorous here.
 */
export const MODERATE_FROM_PCT = 64
export const VIGOROUS_FROM_PCT = 77

export type Intensity = 'light' | 'moderate' | 'vigorous'

export function intensityOf(avgHr: number, maxHr: number): Intensity {
    const pct = (avgHr / maxHr) * 100
    return pct >= VIGOROUS_FROM_PCT ? 'vigorous' : pct >= MODERATE_FROM_PCT ? 'moderate' : 'light'
}

/** Whole years from a birth date (YYYY-MM-DD) to a date; null for a date before it or a bad one */
export function ageOn(dateOfBirth: string | null | undefined, date: string): number | null {
    const born = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '')
    const on = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
    if (!born || !on) return null
    const [by, bm, bd] = born.slice(1).map(Number)
    const [y, m, d] = on.slice(1).map(Number)
    const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
    // A birth date in the future, or over 120 years back, is a typo
    return age >= 0 && age <= 120 ? age : null
}

/**
 * WHO's weekly aerobic amount counts a vigorous minute as two moderate ones (150–300 moderate, or
 * 75–150 vigorous, or an equivalent mix; Bull 2020). Light minutes don't count.
 */
export const moderateEquivalent = (moderate: number, vigorous: number) => moderate + 2 * vigorous
