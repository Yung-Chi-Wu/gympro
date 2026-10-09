// Training periods, shared by the dashboard and the report-scheduler Lambda.
// A period is a calendar week (Monday-Sunday) by default, or one cycle of a
// custom training cycle. Dates are YYYY-MM-DD in the user's own time zone.
// No imports, so the Lambda can bundle this file as-is.

export interface Period {
    periodStart: string
    periodEnd: string
}

export interface CycleSettings {
    cycleLength: number
    startDate: string
}

/** The period today falls in, or null when a custom cycle hasn't started yet. */
export function currentPeriod(timeZone: string, cycle: CycleSettings | null, now = new Date()): Period | null {
    const today = localDate(timeZone, now)
    if (!cycle) {
        const periodStart = mostRecentMonday(today)
        return { periodStart, periodEnd: addDays(periodStart, 6) }
    }
    const daysSinceStart = daysBetween(cycle.startDate, today)
    if (daysSinceStart < 0) return null
    const periodStart = addDays(cycle.startDate, Math.floor(daysSinceStart / cycle.cycleLength) * cycle.cycleLength)
    return { periodStart, periodEnd: addDays(periodStart, cycle.cycleLength - 1) }
}

/**
 * The most recent period that has fully ended (its last day is before today),
 * which is the one a report is due for. Null when no custom cycle has ended yet.
 */
export function lastCompletedPeriod(timeZone: string, cycle: CycleSettings | null, now = new Date()): Period | null {
    const today = localDate(timeZone, now)
    if (!cycle) {
        const periodStart = addDays(mostRecentMonday(today), -7)
        return { periodStart, periodEnd: addDays(periodStart, 6) }
    }
    const cyclesDone = Math.floor(daysBetween(cycle.startDate, today) / cycle.cycleLength)
    if (cyclesDone < 1) return null
    const periodStart = addDays(cycle.startDate, (cyclesDone - 1) * cycle.cycleLength)
    return { periodStart, periodEnd: addDays(periodStart, cycle.cycleLength - 1) }
}

/** Last day of the period that starts on periodStart. */
export function periodEndFor(periodStart: string, cycle: CycleSettings | null): string {
    return addDays(periodStart, (cycle?.cycleLength ?? 7) - 1)
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

function mostRecentMonday(dateIso: string): string {
    const date = new Date(`${dateIso}T12:00:00Z`)
    const day = date.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    date.setUTCDate(date.getUTCDate() + diff)
    return date.toISOString().split('T')[0]
}
