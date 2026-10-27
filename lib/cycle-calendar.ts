import { addDays, cycleDayOf, MAX_CYCLE_DAYS, plannedCycleDay, type CycleSettings } from './periods'
import { datesIn, isTrained, monthOf, monthRange, periodOf, type HistoryDay, type HistoryRange } from './history'

// 課表's calendar (components/CycleCalendar.tsx): a month, Monday first, each day with what the
// training cycle plans for it and whether it was trained. A round of the cycle is a report's
// period (lib/periods.ts), so each day also knows its round. Plans follow the cycle as it is now,
// start on its start date and skip the days the user made rest days, the way a report counts them
// (lambda/ai-worker/src/report/fetch.ts).

export interface CalendarCycle extends CycleSettings {
    /** The routine on each day of the cycle, by day index (1 to cycleLength); none is a rest day */
    routineByDay: Record<number, string | null>
    /** The dates the user made rest days (cycle_rest_days): nothing is planned on them */
    restDates: ReadonlySet<string>
}

/**
 * done: trained. missed: planned, past, not trained. today: planned for today, not trained yet.
 * planned: planned, still ahead. rest: a rest day, in the cycle or made one. none: before the cycle starts.
 */
export type DayStatus = 'done' | 'missed' | 'today' | 'planned' | 'rest' | 'none'

export interface CalendarDay {
    date: string
    /** Day of the cycle, 1 to cycleLength; null before the cycle starts */
    cycleDay: number | null
    /** The routine the cycle plans for the day */
    routineId: string | null
    /** On a day the user made a rest day, the routine the cycle had for it */
    skippedRoutineId: string | null
    status: DayStatus
    /** The cycle's round the day is in: a report's period */
    round: HistoryRange
}

/** Routines in their own color, in the order the cycle first reaches them; the rest share a plain one */
export const ROUTINE_COLORS = 3

/** The routine the cycle plans for a date: none before it starts, on its rest days or on one the user made */
export function plannedRoutine(cycle: CalendarCycle, date: string): string | null {
    const day = plannedCycleDay(cycle, date, cycle.restDates)
    return day === null ? null : cycle.routineByDay[day] ?? null
}

export function calendarDay(date: string, cycle: CalendarCycle, today: string, day: HistoryDay | undefined): CalendarDay {
    const round = periodOf(date, cycle)
    const trained = isTrained(day)
    if (date < cycle.startDate) return { date, cycleDay: null, routineId: null, skippedRoutineId: null, status: trained ? 'done' : 'none', round }
    const cycleDay = cycleDayOf(cycle, date)
    const routineId = plannedRoutine(cycle, date)
    const skippedRoutineId = cycle.restDates.has(date) ? cycle.routineByDay[cycleDay] ?? null : null
    let status: DayStatus
    if (trained) status = 'done'
    else if (!routineId) status = 'rest'
    else status = date < today ? 'missed' : date === today ? 'today' : 'planned'
    return { date, cycleDay, routineId, skippedRoutineId, status, round }
}

/** The sessions the cycle plans in a range: 紀錄's "3 of 4 planned", counted the way the report counts them */
export function plannedSessions(cycle: CalendarCycle, range: HistoryRange): number {
    return datesIn(range).filter((date) => plannedRoutine(cycle, date)).length
}

/** The month's weeks, Monday to Sunday, from the week of the 1st to the week of the last day */
export function monthWeeks(month: string): string[][] {
    const { start, end } = monthRange(month)
    const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
    const dates = datesIn({ start: addDays(start, -weekday(start)), end: addDays(end, 6 - weekday(end)) })
    return Array.from({ length: dates.length / 7 }, (_, i) => dates.slice(i * 7, i * 7 + 7))
}

/** What the calendar reads for a month: its weeks, from the start of the round the first one is in */
export function calendarRange(month: string, cycle: CycleSettings): HistoryRange {
    const weeks = monthWeeks(month)
    return { start: periodOf(weeks[0][0], cycle).start, end: weeks[weeks.length - 1][6] }
}

/**
 * A range that holds calendarRange for today's month in any time zone and any cycle: so the month
 * is read before the user's zone and cycle are in, in the page's first round, and cut to
 * calendarRange once they are. Today in a zone is within a day of today in UTC, and a round starts
 * at most a cycle's length before the month's first week. weeksStart is that week's Monday, where
 * the read splits in two (readHistoryRowsSplit).
 */
export function calendarReadAhead(utcToday: string): { range: HistoryRange; weeksStart: string } {
    const first = monthWeeks(monthOf(addDays(utcToday, -1)))
    const last = monthWeeks(monthOf(addDays(utcToday, 1)))
    return { range: { start: addDays(first[0][0], -(MAX_CYCLE_DAYS - 1)), end: last[last.length - 1][6] }, weeksStart: first[0][0] }
}

/** The first day after `date` the cycle plans a routine for, or null when it plans none */
export function nextPlanned(cycle: CalendarCycle, date: string): { date: string; routineId: string } | null {
    // Within a cycle, and a cycle more for each rest day the user made after it: each can take one
    const restAfter = [...cycle.restDates].filter((d) => d > date).length
    for (let i = 1; i <= cycle.cycleLength * (restAfter + 1); i++) {
        const next = addDays(date, i)
        const routineId = plannedRoutine(cycle, next)
        if (routineId) return { date: next, routineId }
    }
    return null
}

/** Each routine's color slot (0 to ROUTINE_COLORS - 1), by the cycle's order; later ones have none */
export function routineColors(cycle: CalendarCycle): Map<string, number> {
    const slots = new Map<string, number>()
    for (let d = 1; d <= cycle.cycleLength; d++) {
        const id = cycle.routineByDay[d]
        if (id && !slots.has(id) && slots.size < ROUTINE_COLORS) slots.set(id, slots.size)
    }
    return slots
}
