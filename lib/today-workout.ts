import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
import type { LogType } from './exercise-attributes'
import type { WeightUnit } from './weight-unit'
import { logNoteOf, logTypeOf, setValuesOf, type LogNote, type SetValues } from './set-log'
import { localDate } from './periods'
import type { LoggedSet } from './report/types'
import { STRENGTH_LOG_TYPES, type AimFinding } from './report/progression'

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
    /** Its sets before today, from as many periods back as the report reads: what today's aim is worked out from (lib/report/progression.ts todayAim) */
    recent: LoggedSet[]
    /** What it trains and how it is loaded, for the size of a weight step */
    primaryMuscles: string[]
    equipment: string | null
    /**
     * What the routine asks for (routine_exercises). An exercise outside today's routine takes what
     * another of the user's routines asks of it, else as many sets as last time (targetOutsideRoutine);
     * null when it has neither
     */
    target: Target | null
}

export interface Target {
    sets: number
    reps: number | null
}

/** What today's aims are worked out with (lib/report/progression.ts todayAim) */
export interface TodayAims {
    today: string
    /** The period the newest report is of: the last one that ended; null when none has */
    lastPeriod: { start: string; end: string } | null
    /** What that report decided for this period (a lift held for pain, a lighter week, a goal lift taken down), when it is of lastPeriod */
    findings: AimFinding[]
    /** A week or a cycle, for the report's words */
    unit: 'week' | 'cycle'
    /** Where the sets they work from start (UTC), and the zone to date them in */
    recentFrom: { from: string; timeZone: string }
}

export type ExerciseInfo = { name: string; name_zh_tw: string | null; muscle_group: string; log_type: string | null; per_side: boolean | null; equipment: string | null; primary_muscles: string[] | null } | null
export type PlannedRow = { id: string; exercise_id: string; exercises: ExerciseInfo }
export type TargetRow = { exercise_id: string; target_sets: number | null; target_reps: number | null }
export type RoutineRow = TargetRow & { exercises: ExerciseInfo }
export type SetRow = Parameters<typeof setValuesOf>[0] & { id: string; exercise_id: string; set_number: number; created_at: string; exercises: ExerciseInfo }
export type WorkoutRow = {
    id: string
    routine_id: string | null
    workout_planned_exercises: PlannedRow[]
    workout_sets: SetRow[]
    routines: { routine_exercises: TargetRow[] } | null
}
export type PreviousRow = Parameters<typeof setValuesOf>[0] & { workout_id: string; exercise_id: string; set_number: number; workouts: { performed_at: string } }
export type RecentRow = { workout_id: string; exercise_id: string; reps: number; weight_kg: number | null; assist_kg: number | null; created_at: string; workouts: { performed_at: string } }
export type LogUnitRow = { exercise_id: string; unit: string }
export type RoutineTargetRow = TargetRow & { routines: { created_at: string } }

const EXERCISE_COLUMNS = 'name, name_zh_tw, muscle_group, log_type, per_side, equipment, primary_muscles'
const TARGET_COLUMNS = 'exercise_id, target_sets, target_reps'
const targetOf = (re: { target_sets: number | null; target_reps: number | null } | undefined): Target | null =>
    re?.target_sets ? { sets: re.target_sets, reps: re.target_reps } : null
export const SET_COLUMNS = 'reps, weight_kg, duration_s, speed_kmh, incline_pct, level, distance_m, assist_kg, avg_hr, input_unit'
/** Enough earlier sets to find the last session of every exercise done in the past few months */
const PREVIOUS_ROWS = 500
/** The API's most rows a request: two periods of today's exercises fit in it many times over */
const RECENT_ROWS = 1000

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
    return logUnitsOf(data ?? [])
}

export const logUnitsOf = (rows: LogUnitRow[]): Map<string, WeightUnit> =>
    new Map(rows.filter((r) => r.unit === 'kg' || r.unit === 'lb').map((r) => [r.exercise_id, r.unit as WeightUnit]))

/**
 * What the user's routines ask of each exercise (routine_exercises with a target), the newest
 * routine's when more than one has it. For an exercise added just for today, or one in a workout
 * that follows another routine: the user already said how much of it they do.
 */
export async function routineTargets(
    supabase: SupabaseClient<Database>,
    userId: string,
    exerciseIds: string[],
): Promise<Map<string, Target>> {
    if (!exerciseIds.length) return new Map()
    const { data } = await supabase
        .from('routine_exercises')
        .select('exercise_id, target_sets, target_reps, routines!inner ( user_id, created_at )')
        .eq('routines.user_id', userId)
        .in('exercise_id', exerciseIds)
        .not('target_sets', 'is', null)
    return routineTargetsOf((data as unknown as RoutineTargetRow[] | null) ?? [])
}

/** The newest routine's target for each exercise */
export function routineTargetsOf(rows: RoutineTargetRow[]): Map<string, Target> {
    const out = new Map<string, Target>()
    for (const r of [...rows].sort((a, b) => b.routines.created_at.localeCompare(a.routines.created_at))) {
        const target = targetOf(r)
        if (target && !out.has(r.exercise_id)) out.set(r.exercise_id, target)
    }
    return out
}

/**
 * The target of an exercise outside today's routine: what one of the user's routines asks of it,
 * else as many sets as last time, at the reps of last time's first set for a lift. Without
 * either, none: the card then shows today's weight to aim for alone.
 */
export function targetOutsideRoutine(fromRoutines: Target | undefined, previous: SetValues[], logType: LogType): Target | null {
    if (fromRoutines) return fromRoutines
    if (!previous.length) return null
    return { sets: previous.length, reps: STRENGTH_LOG_TYPES.has(logType) && previous[0].reps > 0 ? previous[0].reps : null }
}

/** What an exercise starts the day with: last time's sets, its own kg/lb, the sets today's aim works from, and, when asked, the routines' targets */
export interface Hints {
    previous: Map<string, SetValues[]>
    logUnits: Map<string, WeightUnit>
    recent: Map<string, LoggedSet[]>
    fromRoutines: Map<string, Target>
}

export async function exerciseHints(
    supabase: SupabaseClient<Database>,
    userId: string,
    exerciseIds: string[],
    { before, recentFrom, targets = false }: { before: string; recentFrom?: { from: string; timeZone: string } | null; targets?: boolean },
): Promise<Hints> {
    const [previous, logUnits, recent, fromRoutines] = await Promise.all([
        lastSessionSets(supabase, userId, exerciseIds, before),
        exerciseLogUnits(supabase, userId, exerciseIds),
        recentFrom ? recentSets(supabase, userId, exerciseIds, { from: recentFrom.from, before, timeZone: recentFrom.timeZone }) : new Map<string, LoggedSet[]>(),
        targets ? routineTargets(supabase, userId, exerciseIds) : new Map<string, Target>(),
    ])
    return { previous, logUnits, recent, fromRoutines }
}

/** For each exercise, the sets of the last workout before `before` that had it, in set order. */
export async function lastSessionSets(
    supabase: SupabaseClient<Database>,
    userId: string,
    exerciseIds: string[],
    before: string,
): Promise<Map<string, SetValues[]>> {
    if (!exerciseIds.length) return new Map()
    const { data } = await supabase
        .from('workout_sets')
        .select(`workout_id, exercise_id, set_number, ${SET_COLUMNS}, workouts!inner ( performed_at )`)
        .eq('user_id', userId)
        .in('exercise_id', exerciseIds)
        .lt('workouts.performed_at', before)
        .order('created_at', { ascending: false })
        .limit(PREVIOUS_ROWS)
    return lastSessionsOf((data as unknown as PreviousRow[] | null) ?? [], exerciseIds)
}

/** For each exercise, the sets of the latest workout among these rows that had it, in set order */
export function lastSessionsOf(rows: PreviousRow[], exerciseIds: string[]): Map<string, SetValues[]> {
    const out = new Map<string, SetValues[]>()
    for (const id of exerciseIds) {
        const mine = rows.filter((r) => r.exercise_id === id)
        if (!mine.length) continue
        const last = mine.reduce((a, b) => (b.workouts.performed_at > a.workouts.performed_at ? b : a)).workout_id
        out.set(id, mine.filter((r) => r.workout_id === last).sort((a, b) => a.set_number - b.set_number).map(setValuesOf))
    }
    return out
}

/**
 * For each exercise, its strength sets from `from` up to `before`, dated in the user's time zone,
 * as the report reads sets: what today's aim works from. Cardio and timed sets aren't read.
 */
export async function recentSets(
    supabase: SupabaseClient<Database>,
    userId: string,
    exerciseIds: string[],
    { from, before, timeZone }: { from: string; before: string; timeZone: string },
): Promise<Map<string, LoggedSet[]>> {
    if (!exerciseIds.length) return new Map()
    const { data } = await supabase
        .from('workout_sets')
        .select('workout_id, exercise_id, reps, weight_kg, assist_kg, created_at, workouts!inner ( performed_at )')
        .eq('user_id', userId)
        .in('exercise_id', exerciseIds)
        .gte('workouts.performed_at', from)
        .lt('workouts.performed_at', before)
        .order('created_at', { ascending: false })
        .limit(RECENT_ROWS)
    return recentSetsOf((data as unknown as RecentRow[] | null) ?? [], timeZone)
}

/** These rows as the report reads sets, each exercise's in the rows' order, dated in the user's time zone */
export function recentSetsOf(rows: RecentRow[], timeZone: string): Map<string, LoggedSet[]> {
    const out = new Map<string, LoggedSet[]>()
    for (const r of rows) {
        const set: LoggedSet = {
            date: localDate(timeZone, new Date(r.workouts.performed_at)), workoutId: r.workout_id, exerciseId: r.exercise_id,
            reps: r.reps, weightKg: r.weight_kg ?? 0, assistKg: r.assist_kg, durationS: null, speedKmh: null, distanceM: null, loggedAt: r.created_at,
        }
        out.set(r.exercise_id, [...(out.get(r.exercise_id) ?? []), set])
    }
    return out
}

export async function loadTodayWorkout(
    supabase: SupabaseClient<Database>,
    { userId, range, routineId, routineExerciseIds, language, recentFrom }: {
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
        /** Where the sets for today's aims start (UTC), and the user's time zone to date them in; none: no aims */
        recentFrom?: { from: string; timeZone: string } | null
    },
): Promise<{ workoutId: string | null; exercises: TodayExercise[] }> {
    // Last time's sets, the exercise's own kg/lb, and the sets today's aim works from
    const hintsOf = (ids: string[], targets = false) => exerciseHints(supabase, userId, ids, { before: range.start, recentFrom, targets })
    const known = new Set(routineExerciseIds ?? [])

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
    return todayWorkoutOf({
        workout: workoutData as unknown as WorkoutRow | null,
        routineExercises: (routineData as unknown as RoutineRow[] | null) ?? [],
        known,
        early,
        language,
        moreHints: hintsOf,
    })
}

/**
 * Today's workout from its rows: read here (loadTodayWorkout), or in one request with the rest of
 * Today (today_page, lib/today-page.ts). The workout started today with its plan, sets and the
 * targets of the routine it follows, or, before there is one, today's routine.
 */
export async function todayWorkoutOf({ workout, routineExercises, known, early, language, moreHints }: {
    workout: WorkoutRow | null
    /** Today's routine, in its order; none on a rest day */
    routineExercises: RoutineRow[]
    /** The exercises of today's routine, whose hints are `early` */
    known: ReadonlySet<string>
    early: Hints | null
    language: string
    /** The hints of exercises not in `known`, with the routines' targets when one isn't in the routine the workout follows */
    moreHints: (ids: string[], targets: boolean) => Promise<Hints>
}): Promise<{ workoutId: string | null; exercises: TodayExercise[] }> {
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
        recent: [],
        primaryMuscles: e?.primary_muscles ?? [],
        equipment: e?.equipment ?? null,
        target,
    })
    // Hints for today's routine come with the workout (early); the rest of the card (an exercise
    // added just for today, a workout that follows another routine, or every exercise when the
    // caller didn't know the routine's) takes one more round. An exercise outside the routine the
    // workout follows (`routine`: its exercise ids) is read with the routines' targets too
    const withPrevious = async (exercises: TodayExercise[], early: Hints | null, routine: Set<string>) => {
        const missing = exercises.map((ex) => ex.exerciseId).filter((id) => !known.has(id))
        const more = missing.length ? await moreHints(missing, missing.some((id) => !routine.has(id))) : null
        const hintsFor = (id: string) => (known.has(id) ? early : more)
        return exercises.map((ex) => {
            const hints = hintsFor(ex.exerciseId)
            const previous = hints?.previous.get(ex.exerciseId) ?? []
            return {
                ...ex,
                previous,
                recent: hints?.recent.get(ex.exerciseId) ?? [],
                logUnit: hints?.logUnits.get(ex.exerciseId) ?? null,
                target: routine.has(ex.exerciseId) ? ex.target : targetOutsideRoutine(hints?.fromRoutines.get(ex.exerciseId), previous, ex.logType),
            }
        })
    }

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
            ], early, new Set(targetRows.map((re) => re.exercise_id))),
        }
    }

    return {
        workoutId: null,
        exercises: await withPrevious(routineExercises.map((re) => exerciseOf(re.exercise_id, re.exercises, null, [], targetOf(re))), early, new Set(routineExercises.map((re) => re.exercise_id))),
    }
}
