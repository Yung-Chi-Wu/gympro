import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { RoutineBuilder } from '@/components/RoutineBuilder'
import { CycleScheduler } from '@/components/CycleScheduler'
import type { ExerciseOption } from '@/components/log-types'


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

export default async function RoutinesPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const t = await getTranslations('routines')

    // 並行撈所有資料
    const [profileResult, exercisesResult, routinesResult, cycleResult, detectedLocale] = await Promise.all([
        supabase
            .from('user_profiles')
            .select('language')
            .eq('user_id', user.id)
            .maybeSingle(),
        supabase
            .from('exercises')
            .select('id, name, name_zh_tw, muscle_group, equipment')
            .order('name'),
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
            .select('id, cycle_length, start_date')
            .eq('user_id', user.id)
            .maybeSingle(),
        getLocale(),
    ])

    const language = profileResult.data?.language && profileResult.data.language !== 'en'
        ? profileResult.data.language
        : detectedLocale
    const cycle = cycleResult.data

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

    // 只有有循環才撈 cycle_days
    const cycleDays: CycleDayInfo[] = []
    if (cycle) {
        const { data: days } = await supabase
            .from('cycle_days')
            .select('day_index, routine_id')
            .eq('training_cycle_id', cycle.id)
            .order('day_index')
        cycleDays.push(...(days ?? []).map((d) => ({ dayIndex: d.day_index, routineId: d.routine_id })))
    }

    return (
        <div className="py-8 space-y-10">
            <h1 className="text-3xl font-bold uppercase tracking-wide">{t('title')}</h1>

            <CycleScheduler
                userId={user.id}
                routines={routineList.map((r) => ({ id: r.id, name: r.name }))}
                initialCycle={cycle ? { id: cycle.id, cycleLength: cycle.cycle_length } : null}
                initialCycleDays={cycleDays}
                language={language}
            />

            <RoutineBuilder
                userId={user.id}
                exercises={(exercisesResult.data ?? []) as ExerciseOption[]}
                initialRoutines={routineList}
                language={language}
            />
        </div>
    )
}