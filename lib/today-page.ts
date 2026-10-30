import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './types/database.types'
import type { ExerciseOption } from '@/components/log-types'
import { addDays, currentPeriod, cycleDayOf, lastCompletedPeriod, localDate, PERIOD_DAYS, plannedRoutineId, type Period } from './periods'
import { localDayToUtcRange, timeZoneOf } from './time-zone'
import {
    lastSessionsOf, loadTodayWorkout, logUnitsOf, recentSetsOf, routineTargetsOf, todayWorkoutOf,
    type Hints, type LogUnitRow, type PreviousRow, type RecentRow, type RoutineRow, type RoutineTargetRow, type TodayExercise, type WorkoutRow,
} from './today-workout'
import { recentExerciseIds } from './recent-exercises'
import { latestReportOf, loadLatestReport, type LatestReport } from './report/latest'
import { REPORT_WINDOWS } from './report/progression'
import { reportError } from './report-error'

// Today's reads (app/(app)/dashboard/page.tsx). In one request when it can: today_page
// (migration 20261030130000) reads the same rows as the requests below and returns them nested
// the same way, and this file builds the page from them with the same code. Each request costs
// Supabase's API layer 40-100 ms even for one row, and the page took about 14 of them in two
// rounds. The function works the day out in SQL; the page works it out again here from the
// profile, at the same instant, and if any of the day's values differ (a time zone database
// newer on one side, say), it reads Today the old way and logs which value differed.

/** Everything Today shows, read either way */
export interface TodayData {
    /** The training cycle's length; null without a cycle */
    cycleLength: number | null
    period: Period
    todayIso: string
    todayRange: { start: string; end: string }
    dayIndex: number
    routineIdForToday: string | null
    routineName: string | null
    today: { workoutId: string | null; exercises: TodayExercise[] }
    periodNote: string
    dayNote: string
    todayWeightKg: number | null
    lastWeightKg: number | null
    lastPeriod: { start: string; end: string }
    recentFrom: { from: string; timeZone: string }
    library: ExerciseOption[]
    recentIds: string[]
    latestReport: LatestReport | null
}

interface TodayInput {
    userId: string
    profile: { timezone?: string | null } | null
    language: string
    /** The instant the day is worked out from */
    now: Date
}

type CycleRoutine = { name: string; routine_exercises: { exercise_id: string }[] } | null
type CycleRow = {
    id: string
    cycle_length: number
    start_date: string
    cycle_days: { day_index: number; routine_id: string | null; routines: CycleRoutine }[]
    cycle_date_changes: { change_date: string; routine_id: string | null; routines: CycleRoutine }[]
}

type HintRows = { previous: PreviousRow[]; log_units: LogUnitRow[]; recent: RecentRow[]; targets: RoutineTargetRow[] | null }

/** What today_page returns: the day it worked out, and the rows, as the requests read them */
interface TodayPageRows {
    tz: string
    today: string
    day_start: string
    day_end: string
    period_start: string
    recent_from: string
    routine_id: string | null
    cycle: CycleRow | null
    known: string[]
    more_ids: string[]
    period_note: string | null
    day_note: string | null
    today_weight: number | null
    last_weight: number | null
    workout: WorkoutRow | null
    routine_exercises: RoutineRow[]
    early: HintRows | null
    more: HintRows | null
    library: ExerciseOption[]
    recent_ids: string[]
    latest_report: { status: string; recommendation: Json | null; period_start: string; queued_at: string } | null
}

/** The user's day at `now`: today, its range, this week, and where the sets for today's aims start */
function dayOf(timeZone: string, now: Date) {
    const todayIso = localDate(timeZone, now)
    // Today's aims work from the period the newest report is of, and the days since. The plan holds
    // its range from period to period, so the sets go back as many periods as the report reads.
    const ended = lastCompletedPeriod(timeZone, now)
    const lastPeriod = { start: ended.periodStart, end: ended.periodEnd }
    const aimsFrom = addDays(lastPeriod.start, -(REPORT_WINDOWS - 1) * PERIOD_DAYS)
    return {
        todayIso,
        todayRange: localDayToUtcRange(todayIso, timeZone),
        period: currentPeriod(timeZone, now),
        lastPeriod,
        recentFrom: { from: localDayToUtcRange(aimsFrom, timeZone).start, timeZone },
    }
}

/** The cycle's day today, and the routine it trains with its exercises */
function routineOfDay(cycle: CycleRow | null, todayIso: string) {
    const cycleSettings = cycle ? { cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null
    const dayIndex = cycleSettings ? cycleDayOf(cycleSettings, todayIso) : 0
    // Nothing before the cycle starts or on a rest day; a day the user changed trains the routine they picked
    const routineIdForToday = cycle && cycleSettings
        ? plannedRoutineId(
            cycleSettings,
            Object.fromEntries(cycle.cycle_days.map((d) => [d.day_index, d.routine_id])),
            todayIso,
            new Map(cycle.cycle_date_changes.map((c) => [c.change_date, c.routine_id]))
        )
        : null
    // Its name and exercises, from the cycle's day or the change that has it
    const todayRoutine = routineIdForToday
        ? [...(cycle?.cycle_days ?? []), ...(cycle?.cycle_date_changes ?? [])].find((d) => d.routine_id === routineIdForToday)?.routines ?? null
        : null
    return { dayIndex, routineIdForToday, todayRoutine }
}

/** Today's rows in one request */
export function readTodayPage(supabase: SupabaseClient<Database>, now: Date) {
    return supabase.rpc('today_page', { p_now: now.toISOString(), p_report_windows: REPORT_WINDOWS }, { get: true })
}

/** A value of the day that today_page worked out differently from the page */
class DayDiffers extends Error {
    constructor(readonly what: string, readonly app: string, readonly db: string) {
        super(`Today in one request differs: ${what}`)
    }
}

const sameSet = (a: readonly string[], b: readonly string[]) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join()

/**
 * Today from today_page's rows, built as the requests' rows are. Null, with a warning saying which
 * value differed, when the day the function worked out isn't the page's: the caller then reads
 * Today the old way (loadTodayData).
 */
export async function todayFromPage(rows: Json, { userId, profile, language, now }: TodayInput): Promise<TodayData | null> {
    const page = rows as unknown as TodayPageRows
    const timeZone = timeZoneOf(profile?.timezone)
    const day = dayOf(timeZone, now)
    const { dayIndex, routineIdForToday, todayRoutine } = routineOfDay(page.cycle, day.todayIso)
    const known = [...new Set(todayRoutine?.routine_exercises.map((re) => re.exercise_id) ?? [])]
    const iso = (t: string) => new Date(t).toISOString()
    const hintsOf = (h: HintRows, ids: string[], targets: boolean): Hints => ({
        previous: lastSessionsOf(h.previous, ids),
        logUnits: logUnitsOf(h.log_units),
        recent: recentSetsOf(h.recent, timeZone),
        fromRoutines: targets ? routineTargetsOf(h.targets ?? []) : new Map(),
    })
    try {
        for (const [what, app, db] of [
            ['time zone', timeZone, page.tz],
            ['today', day.todayIso, page.today],
            ['day start', day.todayRange.start, iso(page.day_start)],
            ['day end', day.todayRange.end, iso(page.day_end)],
            ['week', day.period.periodStart, page.period_start],
            ['aims from', day.recentFrom.from, iso(page.recent_from)],
            ['routine', String(routineIdForToday), String(page.routine_id)],
        ]) {
            if (app !== db) throw new DayDiffers(what, app, db)
        }
        if (!sameSet(known, page.known)) throw new DayDiffers('routine exercises', known.join(), page.known.join())

        const today = await todayWorkoutOf({
            workout: page.workout,
            routineExercises: page.routine_exercises,
            known: new Set(known),
            early: page.early && hintsOf(page.early, known, false),
            language,
            // The function read hints for the exercises it found off today's routine: the same ones
            moreHints: async (ids, targets) => {
                if (!page.more || !sameSet(ids, page.more_ids)) throw new DayDiffers('exercises off the routine', ids.join(), page.more_ids.join())
                return hintsOf(page.more, page.more_ids, targets)
            },
        })
        return {
            cycleLength: page.cycle?.cycle_length ?? null,
            ...day,
            dayIndex,
            routineIdForToday,
            routineName: todayRoutine?.name ?? null,
            today,
            periodNote: page.period_note ?? '',
            dayNote: page.day_note ?? '',
            todayWeightKg: page.today_weight,
            lastWeightKg: page.last_weight,
            library: page.library,
            recentIds: [...new Set(page.recent_ids)],
            latestReport: latestReportOf(page.latest_report),
        }
    } catch (err) {
        if (!(err instanceof DayDiffers)) throw err
        reportError('today-page', err, { userId, level: 'warning', context: { app: err.app.slice(0, 200), db: err.db.slice(0, 200) } })
        return null
    }
}

/**
 * Today in two rounds of requests: everything that needs only the user, and as soon as the cycle
 * is in, what needs the user's day: today's workout with last time's sets for today's routine, the
 * notes and the weigh-ins. An exercise outside today's routine takes one more round
 * (lib/today-workout.ts). One query after another was ten rounds.
 */
export async function loadTodayData(supabase: SupabaseClient<Database>, { userId, profile, language, now }: TodayInput): Promise<TodayData> {
    const timeZone = timeZoneOf(profile?.timezone)
    const day = dayOf(timeZone, now)
    // Today in some time zone is within a day of today in UTC: the days changed around it come with the cycle
    const utcToday = now.toISOString().slice(0, 10)
    const firstReads = Promise.all([
        supabase
            .from('exercises')
            .select('id, name, name_zh_tw, muscle_group, equipment, log_type, per_side')
            .order('name'),
        recentExerciseIds(supabase, userId),
        loadLatestReport(supabase, userId),
    ])
    const { data: cycleData } = await supabase
        .from('training_cycles')
        // Each routine's exercises too: last time's sets for today's go out with today's workout
        .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id, routines ( name, routine_exercises ( exercise_id ) ) ), cycle_date_changes ( change_date, routine_id, routines ( name, routine_exercises ( exercise_id ) ) )')
        .eq('user_id', userId)
        .gte('cycle_date_changes.change_date', addDays(utcToday, -1))
        .lte('cycle_date_changes.change_date', addDays(utcToday, 1))
        .maybeSingle()
    const cycle = cycleData as CycleRow | null
    const { dayIndex, routineIdForToday, todayRoutine } = routineOfDay(cycle, day.todayIso)

    const [periodNoteResult, dayNoteResult, todayWeightResult, lastWeightResult, today] = await Promise.all([
        supabase
            .from('period_notes')
            .select('note')
            .eq('user_id', userId)
            .eq('period_start', day.period.periodStart)
            .maybeSingle(),
        supabase
            .from('day_notes')
            .select('note')
            .eq('user_id', userId)
            .eq('note_date', day.todayIso)
            .maybeSingle(),
        // Today's weigh-in, and the one before today as the weight box's hint
        supabase
            .from('body_metrics')
            .select('weight_kg')
            .eq('user_id', userId)
            .gte('recorded_at', day.todayRange.start)
            .lte('recorded_at', day.todayRange.end)
            .not('weight_kg', 'is', null)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase
            .from('body_metrics')
            .select('weight_kg')
            .eq('user_id', userId)
            .lt('recorded_at', day.todayRange.start)
            .not('weight_kg', 'is', null)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        loadTodayWorkout(supabase, {
            userId,
            range: day.todayRange,
            routineId: routineIdForToday,
            routineExerciseIds: todayRoutine?.routine_exercises.map((re) => re.exercise_id) ?? [],
            language,
            recentFrom: day.recentFrom,
        }),
    ])
    const [libraryResult, recentIds, latestReport] = await firstReads

    return {
        cycleLength: cycle?.cycle_length ?? null,
        ...day,
        dayIndex,
        routineIdForToday,
        routineName: todayRoutine?.name ?? null,
        today,
        periodNote: periodNoteResult.data?.note ?? '',
        dayNote: dayNoteResult.data?.note ?? '',
        todayWeightKg: todayWeightResult.data?.weight_kg ?? null,
        lastWeightKg: lastWeightResult.data?.weight_kg ?? null,
        library: (libraryResult.data ?? []) as ExerciseOption[],
        recentIds,
        latestReport,
    }
}
