import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, daysBetween } from '../../../../lib/periods'
import { SUGGESTED_NAMES } from '../../../../lib/report/volume'
import { isCardio, logTypeOf } from '../../../../lib/set-log'
import { WINDOWS } from './facts'
import type { ExerciseInfo, Finding, LoggedSet, ReportInputs, ScheduledDay } from './types'

// Reads what the report needs from the database and turns it into ReportInputs.
// Dates become the user's local dates: the period is defined in their time zone,
// and a set logged at 23:30 in Taipei belongs to that day, not the UTC one.

const PAGE = 1000

/** Every row of a query: PostgREST returns at most 1000 at a time. */
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
    const rows: T[] = []
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await query(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        rows.push(...(data ?? []))
        if ((data?.length ?? 0) < PAGE) return rows
    }
}

interface SetRow {
    exercise_id: string
    reps: number
    weight_kg: number
    duration_s: number | null
    speed_kmh: number | string | null
    distance_m: number | string | null
    assist_kg: number | string | null
    created_at: string
    workout_id: string
    workouts: { performed_at: string }
}
const num = (v: number | string | null) => (v == null ? null : Number(v))

export async function fetchReportInputs(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    periodEnd: string
): Promise<{ inputs: ReportInputs; language: string; weightUnit: 'kg' | 'lb'; distanceUnit: 'km' | 'mi' }> {
    const days = daysBetween(periodStart, periodEnd) + 1
    const lookbackStart = addDays(periodStart, -(WINDOWS - 1) * days)

    const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('timezone, training_goal, language, weight_unit, distance_unit')
        .eq('user_id', userId)
        .maybeSingle()
    if (profileError) throw new Error(`Failed to fetch profile: ${profileError.message}`)
    const timeZone = profile?.timezone || 'UTC'
    const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const localDate = (iso: string) => dateFormat.format(new Date(iso))
    // UTC bounds a day wider on each side; rows are then filtered by local date
    const utcFrom = `${addDays(lookbackStart, -1)}T00:00:00Z`
    const utcTo = `${addDays(periodEnd, 2)}T00:00:00Z`

    const toSet = (r: SetRow): LoggedSet => ({
        date: localDate(r.workouts.performed_at),
        workoutId: r.workout_id,
        exerciseId: r.exercise_id,
        reps: r.reps,
        weightKg: Number(r.weight_kg),
        durationS: r.duration_s,
        speedKmh: num(r.speed_kmh),
        distanceM: num(r.distance_m),
        assistKg: num(r.assist_kg),
        loggedAt: r.created_at,
    })
    // Cardio, timed and assisted sets keep their values outside reps and weight (lib/set-log.ts)
    const setColumns = 'exercise_id, reps, weight_kg, duration_s, speed_kmh, distance_m, assist_kg, created_at, workout_id, workouts!inner(performed_at)'
    const recent = (await fetchAll<SetRow>((from, to) => supabase
        .from('workout_sets')
        .select(setColumns)
        .eq('user_id', userId)
        .gte('workouts.performed_at', utcFrom)
        .lt('workouts.performed_at', utcTo)
        .range(from, to) as unknown as PromiseLike<{ data: SetRow[] | null; error: { message: string } | null }>))
        .map(toSet)
        .filter((s) => s.date >= lookbackStart && s.date <= periodEnd)

    // Earlier sets of this period's exercises, so a record means best ever
    const periodExercises = [...new Set(recent.filter((s) => s.date >= periodStart).map((s) => s.exerciseId))]
    const earlier = periodExercises.length
        ? (await fetchAll<SetRow>((from, to) => supabase
            .from('workout_sets')
            .select(setColumns)
            .eq('user_id', userId)
            .in('exercise_id', periodExercises)
            .lt('workouts.performed_at', `${addDays(lookbackStart, 1)}T00:00:00Z`)
            .range(from, to) as unknown as PromiseLike<{ data: SetRow[] | null; error: { message: string } | null }>))
            .map(toSet)
            .filter((s) => s.date < lookbackStart)
        : []
    const sets = [...earlier, ...recent]

    const schedule = await fetchSchedule(supabase, userId, periodStart, days)
    const plannedIds = (schedule ?? []).flatMap((d) => d.plan.map((p) => p.exerciseId))
    const [exercises, weighIns, routineLeads, previousFindings, notes] = await Promise.all([
        fetchExercises(supabase, [...new Set([...sets.map((s) => s.exerciseId), ...plannedIds])]),
        fetchWeighIns(supabase, userId, utcFrom, utcTo, localDate, lookbackStart, periodEnd),
        fetchRoutineLeads(supabase, userId),
        fetchPreviousFindings(supabase, userId, periodStart),
        fetchDayNotes(supabase, userId, periodStart, periodEnd),
    ])

    return {
        inputs: { periodStart, periodEnd, sets, exercises, schedule, weighIns, goal: profile?.training_goal ?? null, routineLeads, previousFindings, notes },
        language: profile?.language ?? 'en',
        weightUnit: profile?.weight_unit === 'lb' ? 'lb' : 'kg',
        distanceUnit: profile?.distance_unit === 'mi' ? 'mi' : 'km',
    }
}

/** The exercises the user logged or planned, plus the library's staples a low muscle's advice may suggest. */
async function fetchExercises(supabase: SupabaseClient, ids: string[]): Promise<ExerciseInfo[]> {
    const columns = 'id, name, name_zh_tw, muscle_group, primary_muscles, secondary_muscles, log_type'
    const [used, staples] = await Promise.all([
        ids.length ? supabase.from('exercises').select(columns).in('id', ids) : { data: [], error: null },
        supabase.from('exercises').select(columns).in('name', SUGGESTED_NAMES).not('is_custom', 'is', true),
    ])
    if (used.error) throw new Error(`Failed to fetch exercises: ${used.error.message}`)
    if (staples.error) throw new Error(`Failed to fetch suggested exercises: ${staples.error.message}`)
    const rows = [...(used.data ?? []), ...(staples.data ?? []).filter((e) => !ids.includes(e.id))]
    return rows.map((e) => ({
        id: e.id, name: e.name, nameZh: e.name_zh_tw, muscleGroup: e.muscle_group,
        primaryMuscles: e.primary_muscles ?? [], secondaryMuscles: e.secondary_muscles ?? [], logType: logTypeOf(e.log_type),
    }))
}

/** The cycle's routine for each day of the period, or null without a cycle. */
/**
 * Each day's planned routine, from the cycle as it is now. A cycle that started after the period
 * planned nothing in it: no schedule, not a week of rest days that read "3 of 0 planned".
 */
export async function fetchSchedule(supabase: SupabaseClient, userId: string, periodStart: string, days: number): Promise<ScheduledDay[] | null> {
    const { data: cycle, error } = await supabase
        .from('training_cycles')
        .select('id, cycle_length, start_date')
        .eq('user_id', userId)
        .maybeSingle()
    if (error) throw new Error(`Failed to fetch training cycle: ${error.message}`)
    if (!cycle || daysBetween(cycle.start_date, addDays(periodStart, days - 1)) < 0) return null
    const { data: cycleDays, error: daysError } = await supabase
        .from('cycle_days')
        .select('day_index, routines ( name, routine_exercises ( exercise_id, target_sets ) )')
        .eq('training_cycle_id', cycle.id)
    if (daysError) throw new Error(`Failed to fetch cycle days: ${daysError.message}`)
    type Row = { day_index: number; routines: { name: string; routine_exercises: { exercise_id: string; target_sets: number | null }[] } | null }
    const routineFor = new Map(((cycleDays ?? []) as unknown as Row[]).map((d) => [d.day_index, d.routines]))
    return Array.from({ length: days }, (_, i) => {
        const date = addDays(periodStart, i)
        const since = daysBetween(cycle.start_date, date)
        const dayIndex = (((since % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1
        const routine = since < 0 ? null : routineFor.get(dayIndex) ?? null
        return {
            date,
            routine: routine?.name ?? null,
            // A routine exercise with no target counts as 3 sets, the app's default
            plan: (routine?.routine_exercises ?? []).map((re) => ({ exerciseId: re.exercise_id, sets: re.target_sets ?? 3 })),
        }
    })
}

async function fetchWeighIns(
    supabase: SupabaseClient, userId: string, utcFrom: string, utcTo: string,
    localDate: (iso: string) => string, from: string, to: string
): Promise<ReportInputs['weighIns']> {
    const { data, error } = await supabase
        .from('body_metrics')
        .select('recorded_at, weight_kg')
        .eq('user_id', userId)
        .not('weight_kg', 'is', null)
        .gte('recorded_at', utcFrom)
        .lt('recorded_at', utcTo)
    if (error) throw new Error(`Failed to fetch body metrics: ${error.message}`)
    return (data ?? [])
        .map((m) => ({ date: localDate(m.recorded_at), weightKg: Number(m.weight_kg) }))
        .filter((m) => m.date >= from && m.date <= to)
}

/** The first exercise of each routine that isn't cardio: a routine may open with a warm-up on the bike. */
async function fetchRoutineLeads(supabase: SupabaseClient, userId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('routines')
        .select('routine_exercises ( exercise_id, order_index, exercises ( muscle_group, log_type ) )')
        .eq('user_id', userId)
    if (error) throw new Error(`Failed to fetch routines: ${error.message}`)
    type Row = { exercise_id: string; order_index: number; exercises: { muscle_group: string; log_type: string | null } | null }
    const cardio = (r: Row) => !!r.exercises && (isCardio(logTypeOf(r.exercises.log_type)) || r.exercises.muscle_group === 'cardio')
    return ((data ?? []) as unknown as { routine_exercises: Row[] }[])
        .map((r) => [...r.routine_exercises].sort((a, b) => a.order_index - b.order_index).find((x) => !cardio(x))?.exercise_id)
        .filter((id): id is string => !!id)
}

/** The user's note for each day of the period that has one. Already a local date: the app saves it that way. */
async function fetchDayNotes(supabase: SupabaseClient, userId: string, periodStart: string, periodEnd: string): Promise<ReportInputs['notes']> {
    const { data, error } = await supabase
        .from('day_notes')
        .select('note_date, note')
        .eq('user_id', userId)
        .gte('note_date', periodStart)
        .lte('note_date', periodEnd)
        .order('note_date')
    if (error) throw new Error(`Failed to fetch day notes: ${error.message}`)
    return (data ?? []).map((n) => ({ date: n.note_date, note: n.note }))
}

/** The previous report's findings, if it was a version 3 report. */
async function fetchPreviousFindings(supabase: SupabaseClient, userId: string, periodStart: string): Promise<Finding[] | null> {
    const { data, error } = await supabase
        .from('period_reports')
        .select('recommendation')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .lt('period_start', periodStart)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) throw new Error(`Failed to fetch the previous report: ${error.message}`)
    const previous = data?.recommendation as { version?: number; findings?: Finding[] } | null
    return previous?.version === 3 ? previous.findings ?? [] : null
}
