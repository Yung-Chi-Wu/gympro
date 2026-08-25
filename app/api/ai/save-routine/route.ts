import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Exercise {
    exercise_name: string
    exercise_name_zh_tw?: string
    muscle_group: string
    target_sets: number
    target_reps: number
}

interface Routine {
    name: string
    name_zh_tw?: string
    exercises: Exercise[]
}

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { routines }: { routines: Routine[] } = await request.json()

    const savedRoutines = []

    for (const routine of routines) {
        // 建立課表
        const { data: routineData, error: routineError } = await supabase
            .from('routines')
            .insert({ user_id: user.id, name: routine.name })
            .select('id')
            .single()

        if (routineError || !routineData) {
            return NextResponse.json({ error: routineError?.message }, { status: 500 })
        }

        // 找到動作 ID
        for (let i = 0; i < routine.exercises.length; i++) {
            const ex = routine.exercises[i]

            // 先用英文名字搜尋
            const { data: exerciseData } = await supabase
                .from('exercises')
                .select('id')
                .ilike('name', ex.exercise_name)
                .limit(1)
                .maybeSingle()

            if (exerciseData) {
                await supabase.from('routine_exercises').insert({
                    routine_id: routineData.id,
                    exercise_id: exerciseData.id,
                    order_index: i,
                    target_sets: ex.target_sets,
                    target_reps: ex.target_reps,
                })
            }
        }

        savedRoutines.push({ id: routineData.id, name: routine.name })
    }

    return NextResponse.json({ success: true, routines: savedRoutines })
}