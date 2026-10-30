import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './types/database.types'
import type { ExerciseOption } from '@/components/log-types'
import type { HistoryRange, PeriodReportStatus } from './history'
import { loadReportStatuses, readFirstTrainedAt, readHistoryRows, reportStatusesOf, type HistoryRows, type ReportStatusRow } from './history-data'
import { recentExerciseIds } from './recent-exercises'

// 課表's reads (app/(app)/routines/page.tsx). In one request when it can: routines_page
// (migration 20261030210000) reads the same rows as the requests below and returns them nested
// the same way, and the page is built from them with the same code. Each request costs
// Supabase's API layer 40-100 ms even for one row, and the page sent 10 of them beside the
// profile. Nothing here depends on the user's time zone: the calendar's month is read wide
// enough for any (calendarReadAhead) and cut to the user's after, on either path.

export interface RawRoutineExerciseRow {
    id: string
    exercise_id: string
    order_index: number
    target_sets: number | null
    target_reps: number | null
    exercises: { name: string; muscle_group: string } | null
}

export interface RawRoutineRow {
    id: string
    name: string
    routine_exercises: RawRoutineExerciseRow[]
}

interface CycleRow {
    id: string
    cycle_length: number
    start_date: string
    cycle_days: { day_index: number; routine_id: string | null }[]
    cycle_date_changes: { change_date: string; routine_id: string | null }[]
}

/** Everything 課表 reads, either way */
export interface RoutinesData {
    exercises: ExerciseOption[]
    recentIds: string[]
    routines: RawRoutineRow[]
    cycle: CycleRow | null
    history: HistoryRows
    reports: PeriodReportStatus[]
    firstTrainedAt: string | null
}

/** What routines_page returns: the rows, as the requests read them */
interface RoutinesPageRows {
    exercises: ExerciseOption[]
    recent_ids: string[]
    routines: RawRoutineRow[]
    cycle: CycleRow | null
    workouts: HistoryRows['workouts']
    notes: { note_date: string; note: string }[]
    reports: ReportStatusRow[]
    first_trained_at: string | null
}

/** 課表's rows in one request, with the calendar's month read as `range` */
export function readRoutinesPage(supabase: SupabaseClient<Database>, range: HistoryRange) {
    return supabase.rpc('routines_page', { p_start: range.start, p_end: range.end }, { get: true })
}

/** 課表 from routines_page's rows, built as the requests' rows are */
export function routinesFromPage(rows: Json): RoutinesData {
    const page = rows as unknown as RoutinesPageRows
    return {
        exercises: page.exercises,
        recentIds: page.recent_ids,
        routines: page.routines,
        cycle: page.cycle,
        history: { workouts: page.workouts, notes: new Map(page.notes.map((n) => [n.note_date, n.note])) },
        reports: reportStatusesOf(page.reports),
        firstTrainedAt: page.first_trained_at,
    }
}

/** 課表 in one round of requests, for when routines_page fails */
export async function loadRoutinesData(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange): Promise<RoutinesData> {
    const [exercisesResult, recentIds, routinesResult, cycleResult, history, reports, firstTrainedAt] = await Promise.all([
        supabase
            .from('exercises')
            .select('id, name, name_zh_tw, muscle_group, equipment')
            .order('name'),
        recentExerciseIds(supabase, userId),
        supabase
            .from('routines')
            .select(`
                id, name,
                routine_exercises (
                    id, exercise_id, order_index, target_sets, target_reps,
                    exercises ( name, muscle_group )
                )
            `)
            .eq('user_id', userId)
            .order('created_at'),
        supabase
            .from('training_cycles')
            .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id ), cycle_date_changes ( change_date, routine_id )')
            .eq('user_id', userId)
            .order('day_index', { referencedTable: 'cycle_days' })
            .maybeSingle(),
        readHistoryRows(supabase, userId, range),
        loadReportStatuses(supabase, userId, range),
        readFirstTrainedAt(supabase, userId),
    ])
    return {
        exercises: (exercisesResult.data ?? []) as ExerciseOption[],
        recentIds,
        routines: (routinesResult.data as RawRoutineRow[]) ?? [],
        cycle: cycleResult.data,
        history,
        reports,
        firstTrainedAt,
    }
}
