import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
import type { LogType } from './exercise-attributes'
import type { WeightUnit } from './weight-unit'
import { logTypeOf, setValuesOf, type SetValues } from './set-log'

// Today's workout as the dashboard shows it: the workout started today with its sets,
// or, before there is one, today's routine as the plan. The page renders it and the
// card reloads it after Ronnie changes something, so both read it the same way (a card
// that only knew "no workout yet" missed the one Ronnie started).

export interface LoggedSetRow extends SetValues {
    id: string
    setNumber: number
    createdAt: string
}

export interface TodayExercise {
    exerciseId: string
    name: string
    muscleGroup: string
    logType: LogType
    /** The kg/lb this exercise is logged in, as the user last chose it; null for the reading unit (user_profiles.weight_unit) */
    logUnit: WeightUnit | null
    plannedRowId: string | null
    loggedSets: LoggedSetRow[]
    /** The sets of the last earlier workout with this exercise, in order: grey hints in the empty cells */
    previous: SetValues[]
}

type ExerciseInfo = { name: string; name_zh_tw: string | null; muscle_group: string; log_type: string | null } | null
type PlannedRow = { id: string; exercise_id: string; exercises: ExerciseInfo }
type RoutineRow = { exercise_id: string; exercises: ExerciseInfo }
type SetRow = Parameters<typeof setValuesOf>[0] & { id: string; exercise_id: string; set_number: number; created_at: string }
type PreviousRow = Parameters<typeof setValuesOf>[0] & { workout_id: string; exercise_id: string; set_number: number; workouts: { performed_at: string } }

const EXERCISE_COLUMNS = 'name, name_zh_tw, muscle_group, log_type'
export const SET_COLUMNS = 'reps, weight_kg, duration_s, speed_kmh, incline_pct, level, distance_m, assist_kg, input_unit'
/** Enough earlier sets to find the last session of every exercise done in the past few months */
const PREVIOUS_ROWS = 500

/** Today's workout: the latest started in today's range, as everything that reads today's workout picks it. */
export async function findTodayWorkoutId(
    supabase: SupabaseClient<Database>,
    userId: string,
    range: { start: string; end: string },
): Promise<string | null> {
    const { data } = await supabase
        .from('workouts')
        .select('id')
        .eq('user_id', userId)
        .gte('performed_at', range.start)
        .lte('performed_at', range.end)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data?.id ?? null
}

/** The kg/lb the user chose for each of these exercises (exercise_log_units); an exercise without a choice is left out. */
export async function exerciseLogUnits(
    supabase: SupabaseClient<Database>,
    userId: string,
    exerciseIds: string[],
): Promise<Map<string, WeightUnit>> {
    if (!exerciseIds.length) return new Map()
    const { data } = await supabase
        .from('exercise_log_units')
        .select('exercise_id, unit')
        .eq('user_id', userId)
        .in('exercise_id', exerciseIds)
    return new Map((data ?? []).filter((r) => r.unit === 'kg' || r.unit === 'lb').map((r) => [r.exercise_id, r.unit as WeightUnit]))
}

/** For each exercise, the sets of the last workout before `before` that had it, in set order. */
export async function lastSessionSets(
    supabase: SupabaseClient<Database>,
    userId: string,
    exerciseIds: string[],
    before: string,
): Promise<Map<string, SetValues[]>> {
    const out = new Map<string, SetValues[]>()
    if (!exerciseIds.length) return out
    const { data } = await supabase
        .from('workout_sets')
        .select(`workout_id, exercise_id, set_number, ${SET_COLUMNS}, workouts!inner ( performed_at )`)
        .eq('user_id', userId)
        .in('exercise_id', exerciseIds)
        .lt('workouts.performed_at', before)
        .order('created_at', { ascending: false })
        .limit(PREVIOUS_ROWS)
    const rows = (data as unknown as PreviousRow[] | null) ?? []
    for (const id of exerciseIds) {
        const mine = rows.filter((r) => r.exercise_id === id)
        if (!mine.length) continue
        const last = mine.reduce((a, b) => (b.workouts.performed_at > a.workouts.performed_at ? b : a)).workout_id
        out.set(id, mine.filter((r) => r.workout_id === last).sort((a, b) => a.set_number - b.set_number).map(setValuesOf))
    }
    return out
}

export async function loadTodayWorkout(
    supabase: SupabaseClient<Database>,
    { userId, range, routineId, language }: {
        userId: string
        /** Today in the user's time zone, as UTC timestamps */
        range: { start: string; end: string }
        routineId: string | null
        language: string
    },
): Promise<{ workoutId: string | null; exercises: TodayExercise[] }> {
    const nameOf = (e: ExerciseInfo) => (language === 'zh-TW' && e?.name_zh_tw ? e.name_zh_tw : e?.name ?? 'Unknown exercise')
    const exerciseOf = (exerciseId: string, e: ExerciseInfo, plannedRowId: string | null, loggedSets: LoggedSetRow[]) => ({
        exerciseId,
        name: nameOf(e),
        muscleGroup: e?.muscle_group ?? 'other',
        logType: logTypeOf(e?.log_type),
        logUnit: null as WeightUnit | null,
        plannedRowId,
        loggedSets,
        previous: [] as SetValues[],
    })
    // Last time's sets and the exercise's own kg/lb
    const withPrevious = async (exercises: TodayExercise[]) => {
        const ids = exercises.map((ex) => ex.exerciseId)
        const [previous, logUnits] = await Promise.all([lastSessionSets(supabase, userId, ids, range.start), exerciseLogUnits(supabase, userId, ids)])
        return exercises.map((ex) => ({ ...ex, previous: previous.get(ex.exerciseId) ?? [], logUnit: logUnits.get(ex.exerciseId) ?? null }))
    }

    const workoutId = await findTodayWorkoutId(supabase, userId, range)

    if (workoutId) {
        const [plannedResult, setsResult] = await Promise.all([
            supabase
                .from('workout_planned_exercises')
                .select(`id, exercise_id, exercises ( ${EXERCISE_COLUMNS} )`)
                .eq('workout_id', workoutId),
            supabase
                .from('workout_sets')
                .select(`id, exercise_id, set_number, created_at, ${SET_COLUMNS}`)
                .eq('workout_id', workoutId)
                .order('set_number')
                .order('created_at'),
        ])
        const sets = (setsResult.data as unknown as SetRow[] | null) ?? []
        return {
            workoutId,
            exercises: await withPrevious(((plannedResult.data as unknown as PlannedRow[] | null) ?? []).map((p) =>
                exerciseOf(p.exercise_id, p.exercises, p.id, sets
                    .filter((s) => s.exercise_id === p.exercise_id)
                    .map((s) => ({ ...setValuesOf(s), id: s.id, setNumber: s.set_number, createdAt: s.created_at })))
            )),
        }
    }

    if (!routineId) return { workoutId: null, exercises: [] }
    const { data: routineExercises } = await supabase
        .from('routine_exercises')
        .select(`exercise_id, exercises ( ${EXERCISE_COLUMNS} )`)
        .eq('routine_id', routineId)
        .order('order_index')
    return {
        workoutId: null,
        exercises: await withPrevious(((routineExercises as unknown as RoutineRow[] | null) ?? []).map((re) =>
            exerciseOf(re.exercise_id, re.exercises, null, []))),
    }
}
