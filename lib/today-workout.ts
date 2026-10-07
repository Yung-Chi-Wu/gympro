import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'

// Today's workout as the dashboard shows it: the workout started today with its sets,
// or, before there is one, today's routine as the plan. The page renders it and the
// card reloads it after Ronnie changes something, so both read it the same way (a card
// that only knew "no workout yet" missed the one Ronnie started).

export interface TodayExercise {
    exerciseId: string
    name: string
    muscleGroup: string
    plannedRowId: string | null
    loggedSets: { id: string; reps: number; weightKg: number }[]
}

type ExerciseInfo = { name: string; name_zh_tw: string | null; muscle_group: string } | null
type PlannedRow = { id: string; exercise_id: string; exercises: ExerciseInfo }
type SetRow = { id: string; exercise_id: string; reps: number; weight_kg: number }
type RoutineRow = { exercise_id: string; exercises: ExerciseInfo }

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

    const { data: workout } = await supabase
        .from('workouts')
        .select('id')
        .eq('user_id', userId)
        .gte('performed_at', range.start)
        .lte('performed_at', range.end)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (workout) {
        const [plannedResult, setsResult] = await Promise.all([
            supabase
                .from('workout_planned_exercises')
                .select('id, exercise_id, exercises ( name, name_zh_tw, muscle_group )')
                .eq('workout_id', workout.id),
            supabase
                .from('workout_sets')
                .select('id, exercise_id, reps, weight_kg')
                .eq('workout_id', workout.id),
        ])
        const sets = (setsResult.data as SetRow[] | null) ?? []
        return {
            workoutId: workout.id,
            exercises: ((plannedResult.data as PlannedRow[] | null) ?? []).map((p) => ({
                exerciseId: p.exercise_id,
                name: nameOf(p.exercises),
                muscleGroup: p.exercises?.muscle_group ?? 'other',
                plannedRowId: p.id,
                loggedSets: sets
                    .filter((s) => s.exercise_id === p.exercise_id)
                    .map((s) => ({ id: s.id, reps: s.reps, weightKg: s.weight_kg })),
            })),
        }
    }

    if (!routineId) return { workoutId: null, exercises: [] }
    const { data: routineExercises } = await supabase
        .from('routine_exercises')
        .select('exercise_id, exercises ( name, name_zh_tw, muscle_group )')
        .eq('routine_id', routineId)
        .order('order_index')
    return {
        workoutId: null,
        exercises: ((routineExercises as RoutineRow[] | null) ?? []).map((re) => ({
            exerciseId: re.exercise_id,
            name: nameOf(re.exercises),
            muscleGroup: re.exercises?.muscle_group ?? 'other',
            plannedRowId: null,
            loggedSets: [],
        })),
    }
}
