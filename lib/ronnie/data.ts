import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { LogType } from '../exercise-attributes'
import { logTypeOf, setValuesOf, type SetValues } from '../set-log'
import { SET_COLUMNS } from '../today-workout'
import { isMemoryKind, type MemoryNote } from './memory'
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
    /** Empty for custom exercises, which fall back to muscle_group */
    primary_muscles: string[]
    secondary_muscles: string[]
    /** Joint -> low/medium/high; null for custom exercises */
    joint_load: Record<string, string> | null
    /** How its sets are logged (lib/set-log.ts): a treadmill set is minutes and speed, not reps x weight */
    log_type: LogType
    /** Done one side at a time: a set is one side's numbers (lib/set-log.ts logNoteOf) */
    per_side: boolean
    /** For Coach G's planner (plan_routines): what it needs, and how much balance it takes */
    equipment: string | null
    stability_demand: string | null
}

/** A logged set, every column of it, with the workout and exercise it belongs to */
export interface WorkoutSet extends SetValues {
    workout_id: string
    exercise_id: string
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
     * Unfiltered: search_exercises applies its muscle and joint filters to both rankings.
     * Null when vectors aren't available - no embedder, or Bedrock failed or timed out -
     * so the search falls back to keywords instead of failing the turn.
     */
    nearestExercises(query: string): Promise<string[] | null>
    getWorkoutsBetween(startIso: string, endIso: string): Promise<
        { id: string; performed_at: string; workout_planned_exercises: PlannedExercise[] | null }[]
    >
    getLatestWorkoutBetween(startIso: string, endIso: string): Promise<
        { id: string; workout_planned_exercises: PlannedExercise[] | null } | null
    >
    getSets(workoutIds: string[]): Promise<WorkoutSet[]>

    // ---------- writes (each returns an error message, or null on success) ----------
    /** Today's workout id, creating it from today's routine if it doesn't exist yet. */
    ensureTodayWorkout(): Promise<string | null>
    addPlannedExercise(workoutId: string, exerciseId: string): Promise<string | null>
    /** removed = rows actually deleted, so an unknown id is reported instead of a false success */
    removePlannedExercise(workoutId: string, exerciseId: string): Promise<{ error: string | null; removed: number }>
    createProposal(proposal: RoutineProposal): Promise<{ id: string } | { error: string }>

    // ---------- memory: the user's notes (lib/ronnie/memory.ts) ----------
    /** Every note, oldest first; a failed read throws */
    listMemories(): Promise<MemoryNote[]>
    /** Sets a slot's note (its kind and subject), replacing what the slot held; an error message, or null */
    saveMemory(note: MemoryNote): Promise<string | null>
    /** Deletes a slot's note; an error message, or null */
    deleteMemory(slot: Pick<MemoryNote, 'kind' | 'subject'>): Promise<string | null>
}

/** Workouts per sets request (their IDs go in the URL) and rows per page (the API's cap) */
const WORKOUTS_PER_REQUEST = 100
const ROWS_PER_PAGE = 1000

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
    { now = () => new Date(), embedQuery = null, onSearchError = null, admin = null }: {
        now?: () => Date
        /** Turns a search query into a vector (lib/embeddings.ts); null disables vector search */
        embedQuery?: ((text: string) => Promise<number[]>) | null
        /** Told when vector search fails and keywords stand in, so it reaches app_errors (context.ts) */
        onSearchError?: ((err: unknown) => void) | null
        /**
         * The service-role client (lib/supabase/admin.ts) for what users can't write themselves:
         * memory notes and proposals. Every query names userId. Null: no memory (no notes, saving
         * fails) and no proposals.
         */
        admin?: SupabaseClient<Database> | null
    } = {}
): RonnieData {
    // Read once per request: the prompt and the tools both need the notes. A write clears it.
    let notes: Promise<MemoryNote[]> | null = null

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
            const { data } = await supabase.from('exercises').select('id, name, name_zh_tw, muscle_group, primary_muscles, secondary_muscles, joint_load, log_type, per_side, equipment, stability_demand')
            return (data ?? []).map((e) => ({ ...e, joint_load: e.joint_load as Record<string, string> | null, log_type: logTypeOf(e.log_type) }))
        },

        async nearestExercises(query) {
            if (!embedQuery) return null
            try {
                const embedding = await embedQuery(query)
                // RLS applies (security invoker), so another user's custom exercises never match
                const { data, error } = await supabase.rpc('match_exercises', {
                    p_embedding: JSON.stringify(embedding),
                    // Enough that a filter applied afterwards still has candidates
                    p_count: 50,
                })
                if (error) throw error
                return (data ?? []).map((row) => row.id)
            } catch (err) {
                if (onSearchError) onSearchError(err)
                else console.warn('Ronnie vector search unavailable, using keywords:', err)
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
                .order('created_at', { referencedTable: 'workout_planned_exercises' })
                .order('id', { referencedTable: 'workout_planned_exercises' })
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
                // Today's plan in its order, as the logging card shows it
                .order('created_at', { referencedTable: 'workout_planned_exercises' })
                .order('id', { referencedTable: 'workout_planned_exercises' })
                .limit(1)
                .maybeSingle()
            return data as Awaited<ReturnType<RonnieData['getLatestWorkoutBetween']>>
        },

        async getSets(workoutIds) {
            // Every column: cardio, timed and assisted sets keep their values outside reps and weight_kg.
            // A request returns at most 1000 rows, so a few months of sets ("the last 3 months") were cut
            // without a word: read in pages, in a fixed order so no page skips or repeats a row, and a
            // limited number of workouts per request so the URL stays short. A failed read throws
            // (the tool then says so) instead of reading as "no sets".
            type Row = Parameters<typeof setValuesOf>[0] & { workout_id: string; exercise_id: string }
            const rows: Row[] = []
            for (let i = 0; i < workoutIds.length; i += WORKOUTS_PER_REQUEST) {
                const ids = workoutIds.slice(i, i + WORKOUTS_PER_REQUEST)
                for (let from = 0; ; from += ROWS_PER_PAGE) {
                    const { data, error } = await supabase
                        .from('workout_sets')
                        .select(`workout_id, exercise_id, ${SET_COLUMNS}`)
                        .in('workout_id', ids)
                        .order('workout_id')
                        .order('set_number')
                        .order('id')
                        .range(from, from + ROWS_PER_PAGE - 1)
                    if (error) throw new Error(`Could not read the sets: ${error.message}`)
                    rows.push(...((data ?? []) as unknown as Row[]))
                    if ((data?.length ?? 0) < ROWS_PER_PAGE) break
                }
            }
            return rows.map((r) => ({ workout_id: r.workout_id, exercise_id: r.exercise_id, ...setValuesOf(r) }))
        },

        async ensureTodayWorkout() {
            const todayStr = localDateStr(now(), timeZone)
            const range = localDateToUtcRange(todayStr, timeZone)
            // One transaction, shared with the dashboard card (start_today_workout): the latest of
            // today's workouts, or a new one with today's routine planned, each exercise once
            const routineId = await getTodayRoutineId()
            const { data: routineExercises } = routineId
                ? await supabase.from('routine_exercises').select('exercise_id').eq('routine_id', routineId).order('order_index')
                : { data: null }
            const { data, error } = await supabase.rpc('start_today_workout', {
                p_day_start: range.start,
                p_day_end: range.end,
                p_routine_id: routineId,
                p_exercise_ids: (routineExercises ?? []).map((re: { exercise_id: string }) => re.exercise_id),
            })
            return error || !data ? null : data
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
            // Written by the server only: the confirm button and the event Ronnie reads both trust
            // what the stored proposal says
            if (!admin) return { error: 'Proposals are not available' }
            // Expires after a day: an old suggestion shouldn't be confirmable out of context
            const { data, error } = await admin
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

        listMemories() {
            if (!admin) return Promise.resolve([])
            return (notes ??= (async () => {
                const { data, error } = await admin
                    .from('ronnie_memories')
                    .select('kind, subject, state, note, updated_at')
                    .eq('user_id', userId)
                    .order('updated_at')
                if (error) {
                    notes = null
                    throw new Error(`Could not read the memory notes: ${error.message}`)
                }
                return (data ?? []).flatMap((r) => isMemoryKind(r.kind)
                    ? [{ kind: r.kind, subject: r.subject, state: r.state, text: r.note, updatedAt: r.updated_at }]
                    : [])
            })())
        },

        async saveMemory(note) {
            if (!admin) return 'Memory is not available'
            notes = null
            const { error } = await admin.from('ronnie_memories').upsert({
                user_id: userId, kind: note.kind, subject: note.subject, state: note.state, note: note.text, updated_at: note.updatedAt,
            }, { onConflict: 'user_id,kind,subject' })
            return error?.message ?? null
        },

        async deleteMemory({ kind, subject }) {
            if (!admin) return 'Memory is not available'
            notes = null
            const query = admin.from('ronnie_memories').delete().eq('user_id', userId).eq('kind', kind)
            const { error } = await (subject === null ? query.is('subject', null) : query.eq('subject', subject))
            return error?.message ?? null
        },
    }
}
