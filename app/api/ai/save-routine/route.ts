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
    }: {
        routines: Routine[]
        cycleLength: number
        startDayIndex: number
    } = await request.json()

    // 防呆：cycle_length 至少要涵蓋所有 day_indices
    const allDayIndices = routines.flatMap((r) => r.day_indices ?? [])
    const maxDayIndex = allDayIndices.length > 0 ? Math.max(...allDayIndices) : cycleLength
    const effectiveCycleLength = Math.max(cycleLength, maxDayIndex)

    // 計算 start_date
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - (startDayIndex - 1))
    const startDateStr = startDate.toISOString().split('T')[0]

    // 刪掉現有訓練循環
    const { data: existingCycle } = await supabase
        .from('training_cycles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

    if (existingCycle) {
        await supabase.from('cycle_days').delete().eq('training_cycle_id', existingCycle.id)
        await supabase.from('training_cycles').delete().eq('id', existingCycle.id)
    }

    // 刪掉所有現有課表（永遠從零開始）
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
            cycle_length: effectiveCycleLength,
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

    // 補上休息日
    const assignedDays = new Set(routines.flatMap((r) => r.day_indices ?? []))
    const restDayRows = []
    for (let i = 1; i <= effectiveCycleLength; i++) {
        if (!assignedDays.has(i)) {
            restDayRows.push({
                training_cycle_id: cycle.id,
                day_index: i,
                routine_id: null,
            })
        }
    }
    if (restDayRows.length > 0) {
        await supabase.from('cycle_days').insert(restDayRows)
    }

    return NextResponse.json({ success: true, routines: savedRoutines, cycleId: cycle.id })
}