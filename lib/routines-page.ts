import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './types/database.types'
import type { ExerciseOption } from '@/components/log-types'
import type { HistoryRange } from './history'
import { historyFromPage, loadHistoryData, type HistoryData } from './history-page'
import { recentExerciseIds } from './recent-exercises'

// 課表's reads (app/(app)/routines/page.tsx). In one request when it can: routines_page
// (migration 20261030210000) reads the same rows as the requests below and returns them nested
// the same way, and the page is built from them with the same code. Each request costs
// Supabase's API layer 40-100 ms even for one row, and the page sent 10 of them beside the
// profile. The calendar's month is the rows 紀錄 reads too (lib/history-page.ts), and the
// function reads them with history_page. Nothing here depends on the user's time zone: the
// month is read wide enough for any (calendarReadAhead) and cut to the user's after, on either
// path.

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

/** Everything 課表 reads, either way */
export interface RoutinesData extends HistoryData {
    exercises: ExerciseOption[]
    recentIds: string[]
    routines: RawRoutineRow[]
}

/** What routines_page returns beside history_page's rows */
interface RoutinesPageRows {
    exercises: ExerciseOption[]
    recent_ids: string[]
    routines: RawRoutineRow[]
}

/** 課表's rows in one request, with the calendar's month read as `range` */
export function readRoutinesPage(supabase: SupabaseClient<Database>, range: HistoryRange) {
    return supabase.rpc('routines_page', { p_start: range.start, p_end: range.end }, { get: true })
}

/** 課表 from routines_page's rows, built as the requests' rows are */
export function routinesFromPage(rows: Json): RoutinesData {
    const page = rows as unknown as RoutinesPageRows
    return {
        ...historyFromPage(rows),
        exercises: page.exercises,
        recentIds: page.recent_ids,
        routines: page.routines,
    }
}

/** 課表 in one round of requests, for when routines_page fails */
export async function loadRoutinesData(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange): Promise<RoutinesData> {
    const [exercisesResult, recentIds, routinesResult, month] = await Promise.all([
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
        loadHistoryData(supabase, userId, range),
    ])
    return {
        ...month,
        exercises: (exercisesResult.data ?? []) as ExerciseOption[],
        recentIds,
        routines: (routinesResult.data as RawRoutineRow[]) ?? [],
    }
}
