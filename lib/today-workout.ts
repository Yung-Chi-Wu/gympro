import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
import type { LogType } from './exercise-attributes'
import type { WeightUnit } from './weight-unit'
import { logNoteOf, logTypeOf, setValuesOf, type LogNote, type SetValues } from './set-log'

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
    /** What its sets hold when that isn't obvious: one side's numbers, or one dumbbell's weight */
    logNote: LogNote | null
    /** The kg/lb this exercise is logged in, as the user last chose it; null for the reading unit (user_profiles.weight_unit) */
    logUnit: WeightUnit | null
    plannedRowId: string | null
    loggedSets: LoggedSetRow[]
    /** The sets of the last earlier workout with this exercise, in order: grey hints in the empty cells */
    previous: SetValues[]
    /** What the routine asks for (routine_exercises); null for an exercise added just for today */
    target: Target | null
}

export interface Target {
    sets: number
    reps: number | null
}

type ExerciseInfo = { name: string; name_zh_tw: string | null; muscle_group: string; log_type: string | null; per_side: boolean | null; equipment: string | null } | null
type PlannedRow = { id: string; exercise_id: string; exercises: ExerciseInfo }
type TargetRow = { exercise_id: string; target_sets: number | null; target_reps: number | null }
type RoutineRow = TargetRow & { exercises: ExerciseInfo }
type SetRow = Parameters<typeof setValuesOf>[0] & { id: string; exercise_id: string; set_number: number; created_at: string; exercises: ExerciseInfo }
type WorkoutRow = {
    id: string
    routine_id: string | null
    workout_planned_exercises: PlannedRow[]
    workout_sets: SetRow[]
    routines: { routine_exercises: TargetRow[] } | null
}
type PreviousRow = Parameters<typeof setValuesOf>[0] & { workout_id: string; exercise_id: string; set_number: number; workouts: { performed_at: string } }

const EXERCISE_COLUMNS = 'name, name_zh_tw, muscle_group, log_type, per_side, equipment'
const TARGET_COLUMNS = 'exercise_id, target_sets, target_reps'
const targetOf = (re: { target_sets: number | null; target_reps: number | null } | undefined): Target | null =>
    re?.target_sets ? { sets: re.target_sets, reps: re.target_reps } : null
export const SET_COLUMNS = 'reps, weight_kg, duration_s, speed_kmh, incline_pct, level, distance_m, assist_kg, avg_hr, input_unit'
/** Enough earlier sets to find the last session of every exercise done in the past few months */
const PREVIOUS_ROWS = 500

/** Thrown when the page's day has ended: the caller reloads today instead of logging into yesterday */
export class DayOverError extends Error {
    constructor() {
        super('day_over')
        this.name = 'DayOverError'
    }
}

/** Whether the day this range covers is over: a page left open overnight still holds yesterday's */
export const dayIsOver = (range: { end: string }, now = Date.now()) => now > Date.parse(range.end)

/**
 * Today's workout, started if there's none yet (start_today_workout): the workout and its planned
 * exercises in one transaction, each exercise once, in the order given. One that already exists
 * comes back as it is. Refuses a day that is already over (DayOverError).
 */
export async function startTodayWorkout(
    supabase: SupabaseClient<Database>,
    { range, routineId, exerciseIds }: { range: { start: string; end: string }; routineId: string | null; exerciseIds: string[] },
): Promise<string> {
    if (dayIsOver(range)) throw new DayOverError()
    const { data, error } = await supabase.rpc('start_today_workout', {
        p_day_start: range.start,
        p_day_end: range.end,
        p_routine_id: routineId,
        p_exercise_ids: exerciseIds,
    })
    if (error?.message.includes('day_over')) throw new DayOverError()
    if (error || !data) throw new Error(`Could not start today's workout: ${error?.message ?? 'no workout returned'}`, { cause: error })
    return data
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
    { userId, range, routineId, routineExerciseIds, language }: {
        userId: string
        /** Today in the user's time zone, as UTC timestamps */
        range: { start: string; end: string }
        routineId: string | null
        /**
         * The exercises of today's routine, when the caller already has them (the page reads them
         * with the cycle): last time's sets for them then go out with the workout, not after it
         */
        routineExerciseIds?: string[]
        language: string
    },
): Promise<{ workoutId: string | null; exercises: TodayExercise[] }> {
    const nameOf = (e: ExerciseInfo) => (language === 'zh-TW' && e?.name_zh_tw ? e.name_zh_tw : e?.name ?? 'Unknown exercise')
    const exerciseOf = (exerciseId: string, e: ExerciseInfo, plannedRowId: string | null, loggedSets: LoggedSetRow[], target: Target | null): TodayExercise => ({
        exerciseId,
        name: nameOf(e),
        muscleGroup: e?.muscle_group ?? 'other',
        logType: logTypeOf(e?.log_type),
        logNote: logNoteOf(e),
        logUnit: null,
        plannedRowId,
        loggedSets,
        previous: [],
        target,
    })
    // Last time's sets and the exercise's own kg/lb
    const hintsOf = async (ids: string[]) => {
        const [previous, logUnits] = await Promise.all([lastSessionSets(supabase, userId, ids, range.start), exerciseLogUnits(supabase, userId, ids)])
        return { previous, logUnits }
    }
    const known = new Set(routineExerciseIds ?? [])
    // Hints for today's routine come with the workout (early); the rest of the card (an exercise
    // added just for today, a workout that follows another routine, or every exercise when the
    // caller didn't know the routine's) takes one more round
    const withPrevious = async (exercises: TodayExercise[], early: Awaited<ReturnType<typeof hintsOf>> | null) => {
        const missing = exercises.map((ex) => ex.exerciseId).filter((id) => !known.has(id))
        const more = missing.length ? await hintsOf(missing) : null
        const hintsFor = (id: string) => (known.has(id) ? early : more)
        return exercises.map((ex) => ({
            ...ex,
            previous: hintsFor(ex.exerciseId)?.previous.get(ex.exerciseId) ?? [],
            logUnit: hintsFor(ex.exerciseId)?.logUnits.get(ex.exerciseId) ?? null,
        }))
    }

    // One round when the caller knows today's routine, else two: today's workout with its plan, sets
    // and the targets of the routine it follows, read alongside today's routine (the plan before
    // there is a workout) and last time's sets for that routine's exercises
    const [{ data: workoutData }, { data: routineData }, early] = await Promise.all([
        supabase
            .from('workouts')
            .select(`id, routine_id,
                workout_planned_exercises ( id, exercise_id, exercises ( ${EXERCISE_COLUMNS} ) ),
                workout_sets ( id, exercise_id, set_number, created_at, ${SET_COLUMNS}, exercises ( ${EXERCISE_COLUMNS} ) ),
                routines ( routine_exercises ( ${TARGET_COLUMNS} ) )`)
            .eq('user_id', userId)
            .gte('performed_at', range.start)
            .lte('performed_at', range.end)
            // The latest started in today's range, as everything that reads today's workout picks it
            .order('performed_at', { ascending: false })
            // The plan's order: start_today_workout writes each row a moment after the one before
            .order('created_at', { referencedTable: 'workout_planned_exercises' })
            .order('id', { referencedTable: 'workout_planned_exercises' })
            .order('set_number', { referencedTable: 'workout_sets' })
            .order('created_at', { referencedTable: 'workout_sets' })
            .limit(1)
            .maybeSingle(),
        routineId
            ? supabase
                .from('routine_exercises')
                .select(`${TARGET_COLUMNS}, exercises ( ${EXERCISE_COLUMNS} )`)
                .eq('routine_id', routineId)
                .order('order_index')
            : Promise.resolve({ data: null }),
        known.size ? hintsOf([...known]) : null,
    ])
    const workout = workoutData as unknown as WorkoutRow | null
    const routineExercises = (routineData as unknown as RoutineRow[] | null) ?? []

    if (workout) {
        const sets = workout.workout_sets
        const planned = workout.workout_planned_exercises
        // An exercise taken off today's plan after its sets were logged stays on the card with them:
        // History and the report count those sets, so hiding them here made the day disagree
        const offPlanIds = [...new Set(sets.map((s) => s.exercise_id))].filter((id) => !planned.some((p) => p.exercise_id === id))
        // The targets of the routine the workout follows (Ronnie may start one without a routine: today's then)
        const targetRows: TargetRow[] = workout.routine_id ? workout.routines?.routine_exercises ?? [] : routineExercises
        const setsOf = (exerciseId: string) => sets
            .filter((s) => s.exercise_id === exerciseId)
            .map((s) => ({ ...setValuesOf(s), id: s.id, setNumber: s.set_number, createdAt: s.created_at }))
        return {
            workoutId: workout.id,
            exercises: await withPrevious([
                ...planned.map((p) => exerciseOf(p.exercise_id, p.exercises, p.id, setsOf(p.exercise_id), targetOf(targetRows.find((re) => re.exercise_id === p.exercise_id)))),
                ...offPlanIds.map((id) => exerciseOf(id, sets.find((s) => s.exercise_id === id)?.exercises ?? null, null, setsOf(id), null)),
            ], early),
        }
    }

    return {
        workoutId: null,
        exercises: await withPrevious(routineExercises.map((re) => exerciseOf(re.exercise_id, re.exercises, null, [], targetOf(re))), early),
    }
}
