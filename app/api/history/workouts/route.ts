import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface WorkoutSetRow {
    id: string
    exercise_id: string
    reps: number
    weight_kg: number
    set_number: number
}

interface PlannedExerciseRow {
    exercise_id: string
    exercises: { name: string; name_zh_tw: string | null } | null
}

interface WorkoutRow {
    id: string
    title: string | null
    performed_at: string
    workout_planned_exercises: PlannedExerciseRow[]
    workout_sets: WorkoutSetRow[]
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const language = searchParams.get('language') ?? 'en'

    if (!userId || !start || !end) {
        return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const startDate = new Date(`${start}T00:00:00Z`)
    const endDate = new Date(`${end}T23:59:59Z`)

    const { data: workouts } = await supabase
        .from('workouts')
        .select(`
            id, title, performed_at,
            workout_planned_exercises ( exercise_id, exercises ( name, name_zh_tw ) ),
            workout_sets ( id, exercise_id, reps, weight_kg, set_number )
        `)
        .eq('user_id', userId)
        .gte('performed_at', startDate.toISOString())
        .lte('performed_at', endDate.toISOString())
        .order('performed_at', { ascending: true })

    const result = ((workouts as WorkoutRow[]) ?? []).map((w) => {
        const setsByExercise = new Map<string, { reps: number; weightKg: number }[]>()
        for (const s of w.workout_sets ?? []) {
            if (!setsByExercise.has(s.exercise_id)) setsByExercise.set(s.exercise_id, [])
            setsByExercise.get(s.exercise_id)!.push({ reps: s.reps, weightKg: s.weight_kg })
        }

        return {
            id: w.id,
            title: w.title,
            performed_at: w.performed_at,
            exercises: (w.workout_planned_exercises ?? []).map((p) => ({
                exerciseId: p.exercise_id,
                name: language === 'zh-TW' && p.exercises?.name_zh_tw
                    ? p.exercises.name_zh_tw
                    : p.exercises?.name ?? 'Unknown',
                sets: setsByExercise.get(p.exercise_id) ?? [],
            })),
        }
    })

    return NextResponse.json({ workouts: result })
}