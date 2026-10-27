import { createClient } from '@/lib/supabase/server'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { redirect } from 'next/navigation'
import { getEffectiveLanguage } from '@/lib/get-language'
import { localDate } from '@/lib/periods'
import { RoutineBuilder } from '@/components/RoutineBuilder'
import type { ExerciseOption } from '@/components/log-types'
import { timeZoneOf } from '@/lib/time-zone'
import { recentExerciseIds, withRecent } from '@/lib/recent-exercises'
import { ServerTimingMark } from '@/components/ServerTimingMark'
import { ReadYourWrites } from '@/components/ReadYourWrites'
import { calendarRange, calendarReadAhead } from '@/lib/cycle-calendar'
import { historyDaysOf, loadReportStatuses, readFirstTrainedAt, readHistoryRowsSplit } from '@/lib/history-data'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'

export interface RoutineExerciseRow {
    id: string
    exercise_id: string
    exercise_name: string
    muscle_group: string
    order_index: number
    target_sets: number | null
    target_reps: number | null
}

export interface RoutineWithExercises {
    id: string
    name: string
    exercises: RoutineExerciseRow[]
}

export interface CycleDayInfo {
    dayIndex: number
    routineId: string | null
}

interface RawRoutineExerciseRow {
    id: string
    exercise_id: string
    order_index: number
    target_sets: number | null
    target_reps: number | null
    exercises: { name: string; muscle_group: string } | null
}

interface RawRoutineRow {
    id: string
    name: string
    routine_exercises: RawRoutineExerciseRow[]
}

// One round: the profile, the exercise list, the routines, the cycle with its days, and the
// calendar's month: what was trained, the rounds' reports, and the first day ever trained. The
// month's range needs the user's zone and cycle, so it is read as wide as any of them can make it
// (calendarReadAhead) and cut to the calendar's range after; a user with no cycle has no calendar,
// and these reads cost them nothing, being in the same round.
export default async function RoutinesPage() {
    const user = await getSessionUser()
    if (!user) redirect('/login')
    const supabase = await createClient()
    const ahead = calendarReadAhead(new Date().toISOString().slice(0, 10))

    const [{ profile }, exercisesResult, recentIds, routinesResult, cycleResult, historyRows, reports, firstTrainedAt] = await Promise.all([
        getFrameProfile(),
        supabase
            .from('exercises')
            .select('id, name, name_zh_tw, muscle_group, equipment')
            .order('name'),
        recentExerciseIds(supabase, user.id),
        supabase
            .from('routines')
            .select(`
                id, name,
                routine_exercises (
                    id, exercise_id, order_index, target_sets, target_reps,
                    exercises ( name, muscle_group )
                )
            `)
            .eq('user_id', user.id)
            .order('created_at'),
        supabase
            .from('training_cycles')
            .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id ), cycle_rest_days ( rest_date )')
            .eq('user_id', user.id)
            .order('day_index', { referencedTable: 'cycle_days' })
            .maybeSingle(),
        readHistoryRowsSplit(supabase, user.id, ahead.range, ahead.weeksStart),
        loadReportStatuses(supabase, user.id, ahead.range),
        readFirstTrainedAt(supabase, user.id),
    ])
    const language = await getEffectiveLanguage(profile)
    const cycle = cycleResult.data
    const timeZone = timeZoneOf(profile?.timezone)
    const today = localDate(timeZone, new Date())

    const routineList: RoutineWithExercises[] = ((routinesResult.data as RawRoutineRow[]) ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        exercises: (r.routine_exercises ?? [])
            .map((re) => ({
                id: re.id,
                exercise_id: re.exercise_id,
                exercise_name: re.exercises?.name ?? 'Unknown exercise',
                muscle_group: re.exercises?.muscle_group ?? 'other',
                order_index: re.order_index,
                target_sets: re.target_sets,
                target_reps: re.target_reps,
            }))
            .sort((a, b) => a.order_index - b.order_index),
    }))

    const cycleDays: CycleDayInfo[] = (cycle?.cycle_days ?? []).map((d) => ({ dayIndex: d.day_index, routineId: d.routine_id }))

    let calendar = null
    if (cycle) {
        const range = calendarRange(today.slice(0, 7), { cycleLength: cycle.cycle_length, startDate: cycle.start_date })
        calendar = {
            range,
            days: historyDaysOf(historyRows, { range, timeZone, language }),
            reports: reports.filter((r) => r.periodStart >= range.start && r.periodStart <= range.end),
            firstDate: firstTrainedAt && localDate(timeZone, new Date(firstTrainedAt)),
        }
    }
    const weightUnit: WeightUnit = profile?.weight_unit === 'lb' ? 'lb' : 'kg'
    const distanceUnit: DistanceUnit = profile?.distance_unit === 'mi' ? 'mi' : 'km'

    return (
        <>
            <ServerTimingMark />
            <ReadYourWrites />
            {/* A plan saved from Ronnie's card makes a new cycle: the editor then starts over from
                it when the page refreshes, as its state starts from these props */}
            <RoutineBuilder
                key={cycle?.id ?? 'no-cycle'}
                userId={user.id}
                exercises={withRecent((exercisesResult.data ?? []) as ExerciseOption[], recentIds)}
                initialRoutines={routineList}
                language={language}
                initialCycle={cycle ? { id: cycle.id, cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null}
                initialCycleDays={cycleDays}
                initialRestDates={cycle?.cycle_rest_days.map((r) => r.rest_date) ?? []}
                calendar={calendar}
                units={{ weight: weightUnit, distance: distanceUnit }}
                today={today}
            />
        </>
    )
}
