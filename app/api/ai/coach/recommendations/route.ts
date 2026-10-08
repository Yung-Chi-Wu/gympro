import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { loadRonnieContext } from '@/lib/ronnie/context'
import { appendConversation } from '@/lib/ronnie/conversation'
import { eventForDisplay, eventForModel } from '@/lib/ronnie/events'
import { localDateToUtcRange } from '@/lib/ronnie/time'

// "Add to today" on one of Ronnie's recommendation cards: { exerciseId, language }.
// Today's workout is temporary, so it is added right away, the same way Ronnie's
// add_exercise_today tool does it; then today's conversation records it.

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const zh = body?.language === 'zh-TW'
    const ctx = await loadRonnieContext(supabase, user.id)
    // Only an exercise the user can see (RLS limits custom exercises to their creator)
    const exercise = (await ctx.data.listExercises()).find((e) => e.id === body?.exerciseId)
    if (!exercise) return NextResponse.json({ error: 'Unknown exercise' }, { status: 400 })
    const exerciseName = (zh && exercise.name_zh_tw) || exercise.name

    const range = localDateToUtcRange(ctx.today, ctx.timeZone)
    const planned = (await ctx.data.getLatestWorkoutBetween(range.start, range.end))?.workout_planned_exercises ?? []
    if (planned.some((p) => p.exercise_id === exercise.id)) {
        return NextResponse.json({ status: 'already', text: zh ? `「${exerciseName}」已經在今天的訓練裡` : `"${exerciseName}" is already in today's workout` })
    }

    const workoutId = await ctx.data.ensureTodayWorkout()
    const error = workoutId ? await ctx.data.addPlannedExercise(workoutId, exercise.id) : 'no workout'
    if (error) {
        console.error('Recommendation add failed:', error)
        return NextResponse.json({ error: 'Could not add the exercise' }, { status: 500 })
    }

    const event = { kind: 'recommendation_added' as const, exerciseName }
    const text = eventForDisplay(event, zh)
    const saveError = await appendConversation(supabase, ctx.today, {
        messages: [{ role: 'user', content: eventForModel(event) }],
        display: [{ kind: 'event', text }],
    })
    if (saveError) console.error('Ronnie event not saved:', saveError)
    return NextResponse.json({ status: 'added', text, reloadDashboard: true })
}
