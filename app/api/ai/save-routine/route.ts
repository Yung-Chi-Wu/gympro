import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Exercise {
    exercise_id: string
    exercise_name: string
    exercise_name_zh_tw?: string
    muscle_group: string
    target_sets: number
    target_reps: number
}

interface Routine {
    name: string
    name_zh_tw?: string
    day_indices: number[]
    exercises: Exercise[]
}

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
        routines,
        cycleLength,
        startDayIndex,
        replaceExisting,
    }: {
        routines: Routine[]
        cycleLength: number
        startDayIndex: number
        replaceExisting: boolean
    } = await request.json()

    // 計算 start_date
    // 今天是循環的第 startDayIndex 天
    // 所以 start_date = today - (startDayIndex - 1) days
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - (startDayIndex - 1))
    const startDateStr = startDate.toISOString().split('T')[0]

    // 先刪掉現有的訓練循環（一個使用者只能有一個）
    const { data: existingCycle } = await supabase
        .from('training_cycles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

    if (existingCycle) {
        await supabase.from('cycle_days').delete().eq('training_cycle_id', existingCycle.id)
        await supabase.from('training_cycles').delete().eq('id', existingCycle.id)
    }

    // 如果選擇取代，刪掉所有現有課表
    // 永遠刪除現有課表和循環，從零開始
    const { data: existingRoutines } = await supabase
        .from('routines')
        .select('id')
        .eq('user_id', user.id)

    if (existingRoutines && existingRoutines.length > 0) {
        const routineIds = existingRoutines.map((r) => r.id)
        await supabase.from('routine_exercises').delete().in('routine_id', routineIds)
    }

    await supabase.from('routines').delete().eq('user_id', user.id)

    // 建立訓練循環
    const { data: cycle, error: cycleError } = await supabase
        .from('training_cycles')
        .insert({
            user_id: user.id,
            cycle_length: cycleLength,
            start_date: startDateStr,
        })
        .select('id')
        .single()

    if (cycleError || !cycle) {
        return NextResponse.json({ error: cycleError?.message ?? 'Failed to create cycle' }, { status: 500 })
    }

    // 建立每個課表
    const savedRoutines = []

    for (const routine of routines) {
        const { data: routineData, error: routineError } = await supabase
            .from('routines')
            .insert({ user_id: user.id, name: routine.name })
            .select('id')
            .single()

        if (routineError || !routineData) {
            return NextResponse.json({ error: routineError?.message }, { status: 500 })
        }

        // 建立動作（用 exercise_id 直接存，不需要比對名稱）
        if (routine.exercises.length > 0) {
            const exerciseRows = routine.exercises.map((ex, i) => ({
                routine_id: routineData.id,
                exercise_id: ex.exercise_id,
                order_index: i,
                target_sets: ex.target_sets,
                target_reps: ex.target_reps,
            }))

            await supabase.from('routine_exercises').insert(exerciseRows)
        }

        // 建立 cycle_days 對應
        if (routine.day_indices && routine.day_indices.length > 0) {
            const cycleDayRows = routine.day_indices.map((dayIdx) => ({
                training_cycle_id: cycle.id,
                day_index: dayIdx,
                routine_id: routineData.id,
            }))
            await supabase.from('cycle_days').insert(cycleDayRows)
        }

        savedRoutines.push({ id: routineData.id, name: routine.name })
    }

    return NextResponse.json({ success: true, routines: savedRoutines, cycleId: cycle.id })
}