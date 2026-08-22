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

    const result = ((workouts as WorkoutRow[]) ?? [])
        // 過濾掉完全沒有組數的 workout（空紀錄）
        .filter((w) => (w.workout_sets ?? []).length > 0)
        .map((w) => {
            const setsByExercise = new Map<string, { reps: number; weightKg: number }[]>()
            for (const s of w.workout_sets ?? []) {
                if (!setsByExercise.has(s.exercise_id)) setsByExercise.set(s.exercise_id, [])
                setsByExercise.get(s.exercise_id)!.push({ reps: s.reps, weightKg: s.weight_kg })
            }

            const exercises = (w.workout_planned_exercises ?? [])
                .map((p) => ({
                    exerciseId: p.exercise_id,
                    name: language === 'zh-TW' && p.exercises?.name_zh_tw
                        ? p.exercises.name_zh_tw
                        : p.exercises?.name ?? 'Unknown',
                    sets: setsByExercise.get(p.exercise_id) ?? [],
                }))
                // 只顯示有登記組數的動作
                .filter((ex) => ex.sets.length > 0)

            return {
                id: w.id,
                title: w.title,
                performed_at: w.performed_at,
                exercises,
            }
        })
        // 再次過濾：確保每個 workout 至少有一個有組數的動作
        .filter((w) => w.exercises.length > 0)

    return NextResponse.json({ workouts: result })
}