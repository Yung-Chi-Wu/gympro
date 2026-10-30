import { createClient } from '@/lib/supabase/server'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { redirect } from 'next/navigation'
import { getEffectiveLanguage } from '@/lib/get-language'
import { localDate } from '@/lib/periods'
import { RoutineBuilder } from '@/components/RoutineBuilder'
import { timeZoneOf } from '@/lib/time-zone'
import { withRecent } from '@/lib/recent-exercises'
import { ServerTimingMark } from '@/components/ServerTimingMark'
import { ReadYourWrites } from '@/components/ReadYourWrites'
import { calendarRange, calendarReadAhead } from '@/lib/cycle-calendar'
import { historyDaysOf } from '@/lib/history-data'
import { loadRoutinesData, readRoutinesPage, routinesFromPage } from '@/lib/routines-page'
import { reportError } from '@/lib/report-error'
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

// 課表 is read in one request (routines_page, lib/routines-page.ts) beside the profile, which the
// frame reads anyway: the exercise list, the routines, the cycle with its days, and the calendar's
// month: what was trained, the weeks' reports, and the first day ever trained. The month depends
// on the user's zone, so it is read as wide as any zone can make it (calendarReadAhead) and cut to
// the calendar's range after; a user with no cycle has no calendar. When that request fails, the
// page is read the old way, in one round of requests.
export default async function RoutinesPage() {
    const user = await getSessionUser()
    if (!user) redirect('/login')
    const supabase = await createClient()
    const ahead = calendarReadAhead(new Date().toISOString().slice(0, 10))

    const [{ profile }, page] = await Promise.all([getFrameProfile(), readRoutinesPage(supabase, ahead)])
    if (page.error) reportError('routines-page', page.error, { userId: user.id })
    const { exercises, recentIds, routines, cycle, history, reports, firstTrainedAt } = page.data
        ? routinesFromPage(page.data)
        : await loadRoutinesData(supabase, user.id, ahead)
    const language = await getEffectiveLanguage(profile)
    const timeZone = timeZoneOf(profile?.timezone)
    const today = localDate(timeZone, new Date())

    const routineList: RoutineWithExercises[] = routines.map((r) => ({
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
        const range = calendarRange(today.slice(0, 7))
        calendar = {
            range,
            days: historyDaysOf(history, { range, timeZone, language }),
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
                exercises={withRecent(exercises, recentIds)}
                initialRoutines={routineList}
                language={language}
                initialCycle={cycle ? { id: cycle.id, cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null}
                initialCycleDays={cycleDays}
                initialChanges={Object.fromEntries(cycle?.cycle_date_changes.map((c) => [c.change_date, c.routine_id]) ?? [])}
                calendar={calendar}
                units={{ weight: weightUnit, distance: distanceUnit }}
                today={today}
            />
        </>
    )
}
