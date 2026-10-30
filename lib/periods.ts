// Training periods, shared by the dashboard and the report-scheduler Lambda.
// A period, one report's, is a calendar week, Monday to Sunday, for everyone: a cycle plans which
// routine falls on which day, but the report doesn't follow it, since a user whose work hours
// change trains when they can (owner, 2026-10-28; other apps' weekly recaps are calendar weeks
// too). Reports saved before then may cover one round of the cycle. Dates are YYYY-MM-DD in the
// user's own time zone. No imports, so the Lambda can bundle this file as-is.

export interface Period {
    periodStart: string
    periodEnd: string
}

export interface CycleSettings {
    cycleLength: number
    startDate: string
}

/**
 * The longest training cycle, and the longest period a report covers: reports saved before
 * periods were weeks may be one round of a cycle. The database holds both to it (migration
 * 20261014120000), so a report's size has a ceiling.
 */
export const MAX_CYCLE_DAYS = 28

/** Days in a stored period, or null when it can't be one: no end, an end before its start, or longer than a cycle can be */
export function periodDays(periodStart: string, periodEnd: string | null | undefined): number | null {
    if (!periodEnd) return null
    const days = daysBetween(periodStart, periodEnd) + 1
    return days >= 1 && days <= MAX_CYCLE_DAYS ? days : null
}

/** The days a period lasts: a week */
export const PERIOD_DAYS = 7

/** The week a date falls in, Monday to Sunday */
export function weekOf(date: string): Period {
    const periodStart = mostRecentMonday(date)
    return { periodStart, periodEnd: addDays(periodStart, PERIOD_DAYS - 1) }
}

/** The period today falls in: this week */
export function currentPeriod(timeZone: string, now = new Date()): Period {
    return weekOf(localDate(timeZone, now))
}

/** The most recent period that has fully ended, which is the one a report is due for: last week */
export function lastCompletedPeriod(timeZone: string, now = new Date()): Period {
    return weekOf(addDays(localDate(timeZone, now), -PERIOD_DAYS))
}

/**
 * Which day of a training cycle a date is, 1 to cycleLength. Before the cycle's start it
 * counts backwards, so every date has one; whether a day that early has a plan is the
 * caller's to say (a report and the calendar give it none).
 */
export function cycleDayOf(cycle: CycleSettings, date: string): number {
    const since = daysBetween(cycle.startDate, date)
    return (((since % cycle.cycleLength) + cycle.cycleLength) % cycle.cycleLength) + 1
}

/** The dates the user changed in 課表's calendar (cycle_date_changes): the routine each trains instead, or null for a rest day */
export type DateChanges = ReadonlyMap<string, string | null>

/**
 * The routine a date trains, or null when it plans none: before the cycle starts, on the cycle's
 * rest days, or on a date the user made a rest day. A date the user changed trains the routine
 * they picked, and the days around it keep the cycle's: nothing moves. Today, Ronnie, 課表's
 * calendar, 紀錄's counts and the report all ask this, so a changed day is the same everywhere:
 * its routine is the plan, and the one it replaced isn't missed, the round just has its sets fewer.
 */
export function plannedRoutineId(
    cycle: CycleSettings,
    routineByDay: Readonly<Record<number, string | null>>,
    date: string,
    changes: DateChanges
): string | null {
    if (date < cycle.startDate) return null
    const changed = changes.get(date)
    if (changed !== undefined) return changed
    return routineByDay[cycleDayOf(cycle, date)] ?? null
}

/**
 * The last day of a report saved before reports kept their period's end (2026-10-13), when a
 * period could be a round of the cycle: as long as the cycle is now, which a retry also takes
 * (claim_report_retry, migration 20261014120000).
 */
export function periodEndFor(periodStart: string, cycle: CycleSettings | null): string {
    return addDays(periodStart, (cycle?.cycleLength ?? PERIOD_DAYS) - 1)
}

// ---------- Date helpers ----------

export function localDate(timeZone: string, now: Date): string {
    const parts: Record<string, string> = {}
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    for (const part of formatter.formatToParts(now)) {
        parts[part.type] = part.value
    }
    return `${parts.year}-${parts.month}-${parts.day}`
}

export function daysBetween(startDateIso: string, todayIso: string): number {
    const start = new Date(`${startDateIso}T00:00:00Z`)
    const today = new Date(`${todayIso}T00:00:00Z`)
    return Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

export function addDays(dateIso: string, days: number): string {
    const date = new Date(`${dateIso}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().split('T')[0]
}

export function mostRecentMonday(dateIso: string): string {
    const date = new Date(`${dateIso}T12:00:00Z`)
    const day = date.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    date.setUTCDate(date.getUTCDate() + diff)
    return date.toISOString().split('T')[0]
}
