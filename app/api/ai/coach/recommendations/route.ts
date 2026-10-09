import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { loadRonnieContext } from '@/lib/ronnie/context'
import { appendConversation } from '@/lib/ronnie/conversation'
import { eventForDisplay, eventForModel, type RonnieEvent } from '@/lib/ronnie/events'
import { localDateToUtcRange } from '@/lib/ronnie/time'

// The button on one of Ronnie's recommendation cards: { exerciseId, replacesExerciseId?, language }.
// "Add to today" adds the exercise; "Swap" also removes the one it replaces. Today's workout
// is temporary, so this happens right away, the way Ronnie's add/remove tools do it; then
// today's conversation records it.

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const zh = body?.language === 'zh-TW'
    const ctx = await loadRonnieContext(supabase, user.id)
    // Only an exercise the user can see (RLS limits custom exercises to their creator)
    const library = await ctx.data.listExercises()
    const exercise = library.find((e) => e.id === body?.exerciseId)
    if (!exercise) return NextResponse.json({ error: 'Unknown exercise' }, { status: 400 })
    const nameOf = (e: { name: string; name_zh_tw: string | null }) => (zh && e.name_zh_tw) || e.name
    const exerciseName = nameOf(exercise)

    // Created from today's routine if it hasn't started, so the exercise to replace is there
    const workoutId = await ctx.data.ensureTodayWorkout()
    if (!workoutId) return NextResponse.json({ error: "Could not create today's workout" }, { status: 500 })
    const range = localDateToUtcRange(ctx.today, ctx.timeZone)
    const planned = (await ctx.data.getLatestWorkoutBetween(range.start, range.end))?.workout_planned_exercises ?? []
    const replaced = body?.replacesExerciseId ? planned.find((p) => p.exercise_id === body.replacesExerciseId) : undefined
    const alreadyIn = planned.some((p) => p.exercise_id === exercise.id)
    if (alreadyIn && !replaced) {
        return NextResponse.json({ status: 'already', text: zh ? `「${exerciseName}」已經在今天的訓練裡` : `"${exerciseName}" is already in today's workout` })
    }

    // Added before the other is removed: if a step fails, nothing is left missing
    const addError = alreadyIn ? null : await ctx.data.addPlannedExercise(workoutId, exercise.id)
    const removeError = !addError && replaced ? (await ctx.data.removePlannedExercise(workoutId, replaced.exercise_id)).error : null
    if (addError || removeError) {
        console.error('Recommendation card failed:', addError ?? removeError)
        return NextResponse.json({ error: 'Could not change the workout' }, { status: 500 })
    }

    // Swapping for an exercise that was already removed is just an add
    const event: RonnieEvent = replaced
        ? { kind: 'recommendation_swapped', exerciseName, replacedName: replaced.exercises ? nameOf(replaced.exercises) : '?' }
        : { kind: 'recommendation_added', exerciseName }
    const text = eventForDisplay(event, zh)
    const saveError = await appendConversation(supabase, ctx.today, {
        messages: [{ role: 'user', content: eventForModel(event) }],
        display: [{ kind: 'event', text }],
    })
    if (saveError) console.error('Ronnie event not saved:', saveError)
    return NextResponse.json({ status: replaced ? 'swapped' : 'added', text, reloadDashboard: true })
}
