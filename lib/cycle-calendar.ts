import { addDays, cycleDayOf, type CycleSettings } from './periods'
import { datesIn, isTrained, monthRange, periodOf, type HistoryDay, type HistoryRange } from './history'

// 課表's calendar (components/CycleCalendar.tsx): a month, Monday first, each day with what the
// training cycle plans for it and whether it was trained. A round of the cycle is a report's
// period (lib/periods.ts), so each day also knows its round. Plans follow the cycle as it is now
// and start on its start date, the way a report counts them (lambda/ai-worker/src/report/fetch.ts).

export interface CalendarCycle extends CycleSettings {
    /** The routine on each day of the cycle, by day index (1 to cycleLength); none is a rest day */
    routineByDay: Record<number, string | null>
}

/**
 * done: trained. missed: planned, past, not trained. today: planned for today, not trained yet.
 * planned: planned, still ahead. rest: a rest day in the cycle. none: before the cycle starts.
 */
export type DayStatus = 'done' | 'missed' | 'today' | 'planned' | 'rest' | 'none'

export interface CalendarDay {
    date: string
    /** Day of the cycle, 1 to cycleLength; null before the cycle starts */
    cycleDay: number | null
    /** The routine the cycle plans for the day */
    routineId: string | null
    status: DayStatus
    /** The cycle's round the day is in: a report's period */
    round: HistoryRange
}

/** Routines in their own color, in the order the cycle first reaches them; the rest share a plain one */
export const ROUTINE_COLORS = 3

export function calendarDay(date: string, cycle: CalendarCycle, today: string, day: HistoryDay | undefined): CalendarDay {
    const round = periodOf(date, cycle)
    const trained = isTrained(day)
    if (date < cycle.startDate) return { date, cycleDay: null, routineId: null, status: trained ? 'done' : 'none', round }
    const cycleDay = cycleDayOf(cycle, date)
    const routineId = cycle.routineByDay[cycleDay] ?? null
    let status: DayStatus
    if (trained) status = 'done'
    else if (!routineId) status = 'rest'
    else status = date < today ? 'missed' : date === today ? 'today' : 'planned'
    return { date, cycleDay, routineId, status, round }
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

/** The first day after `date` the cycle plans a routine for, or null when it plans none */
export function nextPlanned(cycle: CalendarCycle, date: string): { date: string; routineId: string } | null {
    for (let i = 1; i <= cycle.cycleLength; i++) {
        const next = addDays(date, i)
        if (next < cycle.startDate) continue
        const routineId = cycle.routineByDay[cycleDayOf(cycle, next)]
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
