import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WorkoutLogForm } from '@/components/WorkoutLogForm'
import type { ExerciseOption, LoggedSet } from '@/components/log-types'

interface WorkoutSetRow {
    id: string
    set_number: number
    reps: number
    weight_kg: number
    rpe: number | null
    is_warmup: boolean
    exercise_id: string
    exercises: { name: string; muscle_group: string } | null
}

export default async function LogPage() {
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

    const { startOfDay, endOfDay } = getTodayRange()

    const { data: existingWorkout } = await supabase
        .from('workouts')
        .select('id, title, performed_at')
        .eq('user_id', user.id)
        .gte('performed_at', startOfDay)
        .lte('performed_at', endOfDay)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    let initialSets: LoggedSet[] = []
    if (existingWorkout) {
        const { data: sets } = await supabase
            .from('workout_sets')
            .select(
                `
        id, set_number, reps, weight_kg, rpe, is_warmup, exercise_id,
        exercises ( name, muscle_group )
      `
            )
            .eq('workout_id', existingWorkout.id)
            .order('set_number', { ascending: true })

        initialSets = ((sets as WorkoutSetRow[]) ?? []).map((s) => ({
            id: s.id,
            exerciseId: s.exercise_id,
            exerciseName: s.exercises?.name ?? 'Unknown exercise',
            setNumber: s.set_number,
            reps: s.reps,
            weightKg: s.weight_kg,
            rpe: s.rpe,
            isWarmup: s.is_warmup,
        }))
    }

    return (
        <div className="p-8 max-w-2xl space-y-6">
            <h1 className="text-3xl font-bold uppercase tracking-wide">Log Today's Workout</h1>

            <WorkoutLogForm
                userId={user.id}
                initialWorkoutId={existingWorkout?.id ?? null}
                initialSets={initialSets}
                exercises={(exercises ?? []) as ExerciseOption[]}
            />
        </div>
    )
}

function getTodayRange(): { startOfDay: string; endOfDay: string } {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    return { startOfDay: start.toISOString(), endOfDay: end.toISOString() }
}