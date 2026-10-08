import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { localDateStr, localDateToUtcRange } from './time'

// Everything Ronnie's tools read or write, behind one interface. Production uses
// the Supabase implementation below; the eval swaps in fixture data, so a test
// run never touches the real database and every write can be inspected.

export interface ExerciseNames {
    name: string
    name_zh_tw: string | null
}

export interface PlannedExercise {
    exercise_id: string
    exercises: ExerciseNames | null
}

export interface LibraryExercise {
    id: string
    name: string
    name_zh_tw: string | null
    muscle_group: string
}

/**
 * A permanent routine change waiting for the user to confirm it in the app (a removal
 * asks twice). resolve_ronnie_action in the database applies it.
 */
export type RoutineProposal =
    | { change: 'remove_exercise'; exerciseId: string; exerciseName: string; routineIds: string[]; routineNames: string[] }
    | {
        change: 'add_exercise'
        exerciseId: string
        exerciseName: string
        routineIds: string[]
        routineNames: string[]
        targetSets: number
        targetReps: number
    }

export interface RonnieData {
    // ---------- reads ----------
    findRoutinesByName(name: string): Promise<{ id: string; name: string }[]>
    getRoutineExercises(routineId: string): Promise<
        { exercise_id: string; target_sets: number | null; target_reps: number | null; exercises: (ExerciseNames & { muscle_group: string }) | null }[]
    >
    getRoutineName(routineId: string): Promise<string | null>
    getTodayRoutineId(): Promise<string | null>
    /** The user's routines that contain this exercise. */
    findRoutinesWithExercise(exerciseId: string): Promise<{ id: string; name: string }[]>
    /** Every exercise the user can see; search ranking happens in code (see search.ts). */
    listExercises(): Promise<LibraryExercise[]>
    /**
     * IDs of the exercises nearest in meaning to the query, closest first (vector search).
     * Null when vectors aren't available - no embedder, or Bedrock failed or timed out -
     * so the search falls back to keywords instead of failing the turn.
     */
    nearestExercises(query: string, muscleGroup?: string): Promise<string[] | null>
    getWorkoutsBetween(startIso: string, endIso: string): Promise<
        { id: string; performed_at: string; workout_planned_exercises: PlannedExercise[] | null }[]
    >
    getLatestWorkoutBetween(startIso: string, endIso: string): Promise<
        { id: string; workout_planned_exercises: PlannedExercise[] | null } | null
    >
    getSets(workoutIds: string[]): Promise<{ workout_id: string; exercise_id: string; reps: number; weight_kg: number }[]>

    // ---------- writes (each returns an error message, or null on success) ----------
    /** Today's workout id, creating it from today's routine if it doesn't exist yet. */
    ensureTodayWorkout(): Promise<string | null>
    addPlannedExercise(workoutId: string, exerciseId: string): Promise<string | null>
    /** removed = rows actually deleted, so an unknown id is reported instead of a false success */
    removePlannedExercise(workoutId: string, exerciseId: string): Promise<{ error: string | null; removed: number }>
    createProposal(proposal: RoutineProposal): Promise<{ id: string } | { error: string }>
}

interface CycleRow {
    id: string
    cycle_length: number
    start_date: string
}

/** The production data layer, with the same queries the coach route always made. */
export function createSupabaseRonnieData(
    supabase: SupabaseClient<Database>,
    userId: string,
    timeZone: string,
    cycle: CycleRow | null,
    { now = () => new Date(), embedQuery = null }: {
        now?: () => Date
        /** Turns a search query into a vector (lib/embeddings.ts); null disables vector search */
        embedQuery?: ((text: string) => Promise<number[]>) | null
    } = {}
): RonnieData {
    async function getTodayRoutineId(): Promise<string | null> {
        if (!cycle) return null
        const todayStr = localDateStr(now(), timeZone)
        const startDate = new Date(cycle.start_date + 'T12:00:00Z')
        const todayDate = new Date(todayStr + 'T12:00:00Z')
        const daysSince = Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        const dayIndex = ((daysSince % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length + 1
        const { data: cycleDay } = await supabase
            .from('cycle_days')
            .select('routine_id')
            .eq('training_cycle_id', cycle.id)
            .eq('day_index', dayIndex)
            .maybeSingle()
        return cycleDay?.routine_id ?? null
    }

    return {
        async findRoutinesByName(name) {
            const { data } = await supabase
                .from('routines')
                .select('id, name')
                .eq('user_id', userId)
                .ilike('name', `%${name}%`)
            return data ?? []
        },

        async getRoutineExercises(routineId) {
            const { data } = await supabase
                .from('routine_exercises')
                .select('exercise_id, target_sets, target_reps, order_index, exercises(name, name_zh_tw, muscle_group)')
                .eq('routine_id', routineId)
                .order('order_index')
            return (data ?? []) as Awaited<ReturnType<RonnieData['getRoutineExercises']>>
        },

        async getRoutineName(routineId) {
            const { data: routine } = await supabase
                .from('routines')
                .select('name')
                .eq('id', routineId)
                .maybeSingle()
            return routine?.name ?? null
        },

        getTodayRoutineId,

        async findRoutinesWithExercise(exerciseId) {
            const { data } = await supabase
                .from('routines')
                .select('id, name, routine_exercises!inner(exercise_id)')
                .eq('user_id', userId)
                .eq('routine_exercises.exercise_id', exerciseId)
            return (data ?? []).map((r) => ({ id: r.id, name: r.name }))
        },

        async listExercises() {
            // RLS already limits custom exercises to the user who created them
            const { data } = await supabase.from('exercises').select('id, name, name_zh_tw, muscle_group')
            return data ?? []
        },

        async nearestExercises(query, muscleGroup) {
            if (!embedQuery) return null
            try {
                const embedding = await embedQuery(query)
                // RLS applies (security invoker), so another user's custom exercises never match
                const { data, error } = await supabase.rpc('match_exercises', {
                    p_embedding: JSON.stringify(embedding),
                    p_count: 20,
                    p_muscle_group: muscleGroup ?? undefined,
                })
                if (error) throw error
                return (data ?? []).map((row) => row.id)
            } catch (err) {
                console.warn('Ronnie vector search unavailable, using keywords:', err)
                return null
            }
        },

        async getWorkoutsBetween(startIso, endIso) {
            const { data } = await supabase
                .from('workouts')
                .select(`id, performed_at, workout_planned_exercises(exercise_id, exercises(name, name_zh_tw))`)
                .eq('user_id', userId)
                .gte('performed_at', startIso)
                .lte('performed_at', endIso)
                .order('performed_at')
            return (data ?? []) as Awaited<ReturnType<RonnieData['getWorkoutsBetween']>>
        },

        async getLatestWorkoutBetween(startIso, endIso) {
            const { data } = await supabase
                .from('workouts')
                .select(`id, workout_planned_exercises(exercise_id, exercises(name, name_zh_tw))`)
                .eq('user_id', userId)
                .gte('performed_at', startIso)
                .lte('performed_at', endIso)
                .order('performed_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            return data as Awaited<ReturnType<RonnieData['getLatestWorkoutBetween']>>
        },

        async getSets(workoutIds) {
            const { data } = await supabase
                .from('workout_sets')
                .select('workout_id, exercise_id, reps, weight_kg')
                .in('workout_id', workoutIds)
            return (data ?? []) as Awaited<ReturnType<RonnieData['getSets']>>
        },

        async ensureTodayWorkout() {
            const todayStr = localDateStr(now(), timeZone)
            const range = localDateToUtcRange(todayStr, timeZone)

            const { data: existing } = await supabase
                .from('workouts')
                .select('id')
                .eq('user_id', userId)
                .gte('performed_at', range.start)
                .lte('performed_at', range.end)
                .limit(1)
                .maybeSingle()

            if (existing) return existing.id

            // 建立新 workout
            const { data: newWorkout, error } = await supabase
                .from('workouts')
                .insert({ user_id: userId, performed_at: new Date().toISOString() })
                .select('id')
                .single()

            if (error || !newWorkout) return null

            // 從 routine 複製今天的動作
            const routineId = await getTodayRoutineId()
            if (routineId) {
                const { data: routineExercises } = await supabase
                    .from('routine_exercises')
                    .select('exercise_id')
                    .eq('routine_id', routineId)
                    .order('order_index')

                if (routineExercises?.length) {
                    const rows = routineExercises.map((re: { exercise_id: string }) => ({
                        workout_id: newWorkout.id,
                        exercise_id: re.exercise_id,
                        user_id: userId,
                    }))
                    await supabase.from('workout_planned_exercises').insert(rows)
                }
            }

            return newWorkout.id
        },

        async addPlannedExercise(workoutId, exerciseId) {
            const { error } = await supabase
                .from('workout_planned_exercises')
                .insert({ workout_id: workoutId, exercise_id: exerciseId, user_id: userId })
            return error?.message ?? null
        },

        async removePlannedExercise(workoutId, exerciseId) {
            const { data, error } = await supabase
                .from('workout_planned_exercises')
                .delete()
                .eq('workout_id', workoutId)
                .eq('exercise_id', exerciseId)
                .select('id')
            return { error: error?.message ?? null, removed: data?.length ?? 0 }
        },

        async createProposal(proposal) {
            // Expires after a day: an old suggestion shouldn't be confirmable out of context
            const { data, error } = await supabase
                .from('ronnie_pending_actions')
                .insert({
                    user_id: userId,
                    action: proposal as unknown as Database['public']['Tables']['ronnie_pending_actions']['Insert']['action'],
                    expires_at: new Date(now().getTime() + 24 * 60 * 60 * 1000).toISOString(),
                })
                .select('id')
                .single()
            return error || !data ? { error: error?.message ?? 'Failed to save the proposal' } : { id: data.id }
        },
    }
}
