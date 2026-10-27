import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
import { addDays, localDate } from './periods'
import { logTypeOf, setValuesOf } from './set-log'
import { SET_COLUMNS } from './today-workout'
import { shownStatus } from './report/queue'
import { REPORTS_PER_PAGE, type HistoryDay, type HistoryExercise, type HistoryRange, type PeriodReportStatus, type ReportTrend } from './history'

// Reads for the 紀錄 page, by date range only (see lib/history.ts): the page's first
// render and /api/history/workouts both use them.

type SetRow = Parameters<typeof setValuesOf>[0] & {
    exercise_id: string
    set_number: number
    created_at: string
    exercises: { name: string; name_zh_tw: string | null; log_type: string | null } | null
}

interface WorkoutRow {
    id: string
    performed_at: string
    routines: { name: string } | null
    workout_sets: SetRow[]
}

const TRENDS: ReportTrend[] = ['progressing', 'stalling', 'regressing', 'baseline']

/** The days in a range (the user's own dates) that have sets or a note, oldest first */
export async function loadHistoryDays(
    supabase: SupabaseClient<Database>,
    { userId, range, timeZone, language }: { userId: string; range: HistoryRange; timeZone: string; language: string },
): Promise<HistoryDay[]> {
    return historyDaysOf(await readHistoryRows(supabase, userId, range), { range, timeZone, language })
}

/** What loadHistoryDays reads for a range, before it is sorted into the user's days */
export interface HistoryRows {
    workouts: WorkoutRow[]
    notes: Map<string, string>
}

/**
 * loadHistoryDays' reads, which need no time zone: a page can send them before the user's profile
 * is in, then sort them with historyDaysOf, into any range inside this one
 */
export async function readHistoryRows(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange): Promise<HistoryRows> {
    // performed_at is an instant and the range is in the user's dates: ask a day wider on
    // each side, and historyDaysOf keeps the workouts whose local date falls inside
    const [workoutsResult, notes] = await Promise.all([
        supabase
            .from('workouts')
            .select(`
                id, performed_at,
                routines ( name ),
                workout_sets ( exercise_id, set_number, created_at, ${SET_COLUMNS}, exercises ( name, name_zh_tw, log_type ) )
            `)
            .eq('user_id', userId)
            .gte('performed_at', `${addDays(range.start, -1)}T00:00:00Z`)
            .lte('performed_at', `${addDays(range.end, 1)}T23:59:59.999Z`)
            .order('performed_at', { ascending: true }),
        loadDayNotes(supabase, userId, range),
    ])
    return { workouts: (workoutsResult.data ?? []) as unknown as WorkoutRow[], notes }
}

/**
 * readHistoryRows in two queries at once, split at `at`: each brings half the rows, so both are back
 * sooner than one with all of them (課表's month read ahead: about 80 ms against 105). A workout
 * both read, as each asks a day wider, is kept once.
 */
export async function readHistoryRowsSplit(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange, at: string): Promise<HistoryRows> {
    const [before, after] = await Promise.all([
        readHistoryRows(supabase, userId, { start: range.start, end: addDays(at, -1) }),
        readHistoryRows(supabase, userId, { start: at, end: range.end }),
    ])
    const inAfter = new Set(after.workouts.map((w) => w.id))
    return {
        workouts: [...before.workouts.filter((w) => !inAfter.has(w.id)), ...after.workouts],
        notes: new Map([...before.notes, ...after.notes]),
    }
}

/** The days in a range, from rows read for it or for a range around it */
export function historyDaysOf(
    { workouts, notes }: HistoryRows,
    { range, timeZone, language }: { range: HistoryRange; timeZone: string; language: string },
): HistoryDay[] {
    const days = new Map<string, HistoryDay>()
    const dayOf = (date: string) => {
        let day = days.get(date)
        if (!day) {
            day = { date, routineNames: [], exercises: [], note: null }
            days.set(date, day)
        }
        return day
    }

    for (const workout of workouts) {
        const date = localDate(timeZone, new Date(workout.performed_at))
        if (date < range.start || date > range.end || !workout.workout_sets?.length) continue
        const day = dayOf(date)
        const routineName = workout.routines?.name
        if (routineName && !day.routineNames.includes(routineName)) day.routineNames.push(routineName)

        // Exercises in the order they were trained, each set in its own order
        const sets = [...workout.workout_sets].sort((a, b) =>
            a.created_at.localeCompare(b.created_at) || a.set_number - b.set_number)
        for (const set of sets) {
            let exercise: HistoryExercise | undefined = day.exercises.find((ex) => ex.exerciseId === set.exercise_id)
            if (!exercise) {
                exercise = {
                    exerciseId: set.exercise_id,
                    name: (language === 'zh-TW' && set.exercises?.name_zh_tw) || set.exercises?.name || 'Unknown',
                    logType: logTypeOf(set.exercises?.log_type),
                    sets: [],
                }
                day.exercises.push(exercise)
            }
            exercise.sets.push(setValuesOf(set))
        }
    }

    for (const [date, note] of notes) if (date >= range.start && date <= range.end) dayOf(date).note = note

    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** The user's day notes in a range, by date */
async function loadDayNotes(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange): Promise<Map<string, string>> {
    const { data } = await supabase
        .from('day_notes')
        .select('note_date, note')
        .eq('user_id', userId)
        .gte('note_date', range.start)
        .lte('note_date', range.end)
    return new Map((data ?? []).map((n) => [n.note_date, n.note]))
}

/** Which periods starting in the range have a report, and its verdict */
export async function loadReportStatuses(
    supabase: SupabaseClient<Database>,
    userId: string,
    range: HistoryRange,
): Promise<PeriodReportStatus[]> {
    const { data } = await supabase
        .from('period_reports')
        .select('period_start, status, queued_at, trend:recommendation->facts->>status')
        .eq('user_id', userId)
        .gte('period_start', range.start)
        .lte('period_start', range.end)
    return (data ?? []).map((r) => ({
        periodStart: r.period_start,
        // A pending report whose run died isn't "being made"
        status: shownStatus(r),
        trend: r.status === 'completed' && TRENDS.includes(r.trend as ReportTrend) ? (r.trend as ReportTrend) : null,
    }))
}

/** A page of full reports, newest first: the latest, or the ones before a period */
export async function loadReports(supabase: SupabaseClient<Database>, userId: string, before?: string) {
    let query = supabase
        .from('period_reports')
        .select('period_start, period_end, status, queued_at, recommendation, created_at')
        .eq('user_id', userId)
        .order('period_start', { ascending: false })
        .limit(REPORTS_PER_PAGE)
    if (before) query = query.lt('period_start', before)
    const { data } = await query
    return data ?? []
}

/** The first day the user trained, so the list knows when there is nothing older to load */
export async function loadFirstTrainedDate(
    supabase: SupabaseClient<Database>,
    userId: string,
    timeZone: string,
): Promise<string | null> {
    const at = await readFirstTrainedAt(supabase, userId)
    return at && localDate(timeZone, new Date(at))
}

/** When the user first trained (an instant), for a page that reads it before it has the user's time zone */
export async function readFirstTrainedAt(supabase: SupabaseClient<Database>, userId: string): Promise<string | null> {
    const { data } = await supabase
        .from('workouts')
        .select('performed_at, workout_sets!inner ( id )')
        .eq('user_id', userId)
        .order('performed_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    return data?.performed_at ?? null
}
