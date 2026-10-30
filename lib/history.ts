import type { LogType } from './exercise-attributes'
import { addDays, daysBetween, PERIOD_DAYS, weekOf } from './periods'
import type { SetValues } from './set-log'

// The 紀錄 page's data: one entry per day the user trained, grouped into periods (calendar
// weeks, a report's period: lib/periods.ts). Records are kept forever, so the
// page never asks for all of them: the side-by-side view loads one month, the phone list
// four periods at a time (more on request). Used by the page, its API and its components.

export interface HistoryExercise {
    exerciseId: string
    name: string
    logType: LogType
    sets: SetValues[]
}

export interface HistoryDay {
    /** YYYY-MM-DD in the user's time zone */
    date: string
    /** The routines the day's workouts followed; empty for a workout without one */
    routineNames: string[]
    /** In the order they were trained; empty on a day with only a note */
    exercises: HistoryExercise[]
    /** The user's note for the day (day_notes), if there is one */
    note: string | null
}

export type ReportTrend = 'progressing' | 'stalling' | 'regressing' | 'baseline'

/** A period's report, enough for a label: the full report loads on the 報告 tab */
export interface PeriodReportStatus {
    periodStart: string
    status: string
    /** The report's verdict (report v3, facts.status); null for older reports and ones not finished */
    trend: ReportTrend | null
}

export interface HistoryRange {
    start: string
    end: string
}

export interface PeriodRange extends HistoryRange {
    /** Whether today falls in it */
    current: boolean
}

/** The longest range one request may ask for */
export const MAX_RANGE_DAYS = 400

/** How many periods the phone list shows at first, and adds each time */
export const PERIODS_PER_PAGE = 4

/** Reports on the 報告 tab come a page at a time, newest first */
export const REPORTS_PER_PAGE = 6

/** A day that exists, YYYY-MM-DD: the pattern alone lets 2026-02-30 and 2026-13-01 through */
export const isDate = (s: string | null | undefined): s is string => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
    // Date rolls 2026-02-30 over to March 2, and gives NaN for month 13
    const t = Date.parse(`${s}T00:00:00Z`)
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}
export const isMonth = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

/** The period a day falls in: its week */
export function periodOf(date: string): HistoryRange {
    const { periodStart, periodEnd } = weekOf(date)
    return { start: periodStart, end: periodEnd }
}

/** The period that contains `from` and the `count - 1` before it, newest first */
export function periodsBack(from: string, count: number, today: string): PeriodRange[] {
    const periods: PeriodRange[] = []
    let period = periodOf(from)
    for (let i = 0; i < count; i++) {
        periods.push({ ...period, current: period.start <= today && today <= period.end })
        period = periodOf(addDays(period.start, -1))
    }
    return periods
}

/** The periods that overlap a range, newest first */
export function periodsSpanning({ start, end }: HistoryRange, today: string): PeriodRange[] {
    const count = Math.floor(daysBetween(periodOf(start).start, periodOf(end).start) / PERIOD_DAYS) + 1
    return periodsBack(end, count, today)
}

/** The periods that overlap a month (YYYY-MM), newest first */
export const periodsInMonth = (month: string, today: string) =>
    periodsSpanning(monthRange(month), today)

/** From the oldest period's first day to the newest's last */
export const rangeOf = (periods: HistoryRange[]): HistoryRange => ({
    start: periods.reduce((min, p) => (p.start < min ? p.start : min), periods[0].start),
    end: periods.reduce((max, p) => (p.end > max ? p.end : max), periods[0].end),
})

export function monthRange(month: string): HistoryRange {
    const [y, m] = month.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

export const monthOf = (date: string) => date.slice(0, 7)

export function addMonths(month: string, n: number): string {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + n, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Every date from start to end */
export function datesIn({ start, end }: HistoryRange): string[] {
    const dates: string[] = []
    for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d)
    return dates
}

export const isTrained = (day: HistoryDay | undefined) => !!day && day.exercises.length > 0

export const setCount = (day: HistoryDay) => day.exercises.reduce((n, ex) => n + ex.sets.length, 0)

/** Estimated one-rep max (Epley), as the report and the logging card measure a best set */
const e1rm = (s: SetValues) => s.weightKg * (1 + s.reps / 30)

/**
 * The day's headline for its list row: the first exercise trained (a routine's first
 * exercise is one of the report's main lifts) and its best set, the one with the highest
 * estimated 1RM; for bodyweight work, the most added weight, then the most reps. Null
 * when the first exercise is timed or cardio: the row lists the exercises instead.
 */
export function bestSetOf(day: HistoryDay): { exercise: HistoryExercise; set: SetValues } | null {
    const exercise = day.exercises[0]
    if (!exercise?.sets.length || (exercise.logType !== 'weight_reps' && exercise.logType !== 'bodyweight')) return null
    const set = exercise.sets.reduce((best, s) => (e1rm(s) > e1rm(best) || (e1rm(s) === e1rm(best) && s.reps > best.reps) ? s : best))
    return { exercise, set }
}
