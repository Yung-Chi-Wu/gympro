import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
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

    if (!user) {
        redirect('/login')
    }

    const { data: exercises } = await supabase
        .from('exercises')
        .select('id, name, muscle_group, equipment')
        .order('name')

    const { data: routines } = await supabase
        .from('routines')
        .select(
            `
      id, name,
      routine_exercises (
        id, exercise_id, order_index, target_sets, target_reps,
        exercises ( name, muscle_group )
      )
    `
        )
        .eq('user_id', user.id)
        .order('created_at')

    const routineList: RoutineWithExercises[] = ((routines as RawRoutineRow[]) ?? []).map((r) => ({
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

    const { data: cycle } = await supabase
        .from('training_cycles')
        .select('id, cycle_length, start_date')
        .eq('user_id', user.id)
        .maybeSingle()

    let cycleDays: CycleDayInfo[] = []
    if (cycle) {
        const { data: days } = await supabase
            .from('cycle_days')
            .select('day_index, routine_id')
            .eq('training_cycle_id', cycle.id)
            .order('day_index')

        cycleDays = (days ?? []).map((d) => ({ dayIndex: d.day_index, routineId: d.routine_id }))
    }

    return (
        <div className="p-8 max-w-2xl space-y-10">
            <h1 className="text-3xl font-bold uppercase tracking-wide">Routines</h1>

            <CycleScheduler
                userId={user.id}
                routines={routineList.map((r) => ({ id: r.id, name: r.name }))}
                initialCycle={cycle ? { id: cycle.id, cycleLength: cycle.cycle_length } : null}
                initialCycleDays={cycleDays}
            />

            <RoutineBuilder
                userId={user.id}
                exercises={(exercises ?? []) as ExerciseOption[]}
                initialRoutines={routineList}
            />
        </div>
    )
}