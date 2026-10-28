import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { refusedResponse, takeAiSlot } from '@/lib/ai/model-client'
import { traceAfterResponse } from '@/lib/ai/trace-after'
import { reportError } from '@/lib/report-error'
import { recentExerciseIds } from '@/lib/recent-exercises'
import { GOAL_READER_MODEL, keptRead, readGoal } from '@/lib/report/goal-reader'
import type { ExerciseInfo } from '@/lib/report/types'
import { logTypeOf } from '@/lib/set-log'

// The user's goal as read, for Settings to show under it (lib/report/goal-reader.ts): what the
// report will track, seen when the goal is saved, not a week later. It reads the goal as saved,
// not a text sent here. A goal read before is answered from the read kept with it
// (user_profiles.training_goal_read); a new one costs one small call, under the user's spend
// limits, and is kept, so every report reuses it while the text is the same. { read } is null
// without a goal; a read whose model is null couldn't be made, and the next report tries again.

const READER_CLIENT = { maxRetries: 1 }

export async function POST() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('training_goal, training_goal_read, weight_unit')
        .eq('user_id', user.id)
        .maybeSingle()
    if (profileError) {
        reportError('goal-read', profileError, { userId: user.id, context: { step: 'profile' } })
        return NextResponse.json({ error: 'Read failed' }, { status: 500 })
    }
    const goal = profile?.training_goal?.trim() ?? ''
    if (!profile || !goal) return NextResponse.json({ read: null })
    const kept = keptRead(profile.training_goal_read, goal)
    if (kept) return NextResponse.json({ read: kept })

    // Only the service role keeps the read (the migration's trigger); without it, nothing is read
    const admin = createAdminClient()
    if (!admin) {
        reportError('goal-read', 'SUPABASE_SERVICE_ROLE_KEY is not set', { userId: user.id })
        return NextResponse.json({ error: 'Read failed' }, { status: 500 })
    }

    // The library, and the exercises the user logs lately, which a goal's lift is matched to first
    const [{ data: rows, error: libraryError }, recent] = await Promise.all([
        supabase.from('exercises').select('id, name, name_zh_tw, muscle_group, primary_muscles, secondary_muscles, log_type').not('is_custom', 'is', true).order('name'),
        recentExerciseIds(supabase, user.id),
    ])
    if (libraryError) {
        reportError('goal-read', libraryError, { userId: user.id, context: { step: 'library' } })
        return NextResponse.json({ error: 'Read failed' }, { status: 500 })
    }
    const library: ExerciseInfo[] = (rows ?? []).map((e) => ({
        id: e.id, name: e.name, nameZh: e.name_zh_tw, muscleGroup: e.muscle_group,
        primaryMuscles: e.primary_muscles ?? [], secondaryMuscles: e.secondary_muscles ?? [], logType: logTypeOf(e.log_type),
    }))
    const byId = new Map(library.map((e) => [e.id, e]))
    const own = recent.flatMap((id) => byId.get(id) ?? [])

    const { slot, refused } = await takeAiSlot(user.id, READER_CLIENT)
    if (refused) return refusedResponse(refused)
    const started = Date.now()
    const weightUnit = profile.weight_unit === 'lb' ? 'lb' : 'kg'
    const { read, call } = await readGoal(slot.client, goal, { previous: null, own, library, weightUnit })
    traceAfterResponse({
        userId: user.id, feature: 'goal', model: GOAL_READER_MODEL, servedModel: call?.model ?? null, status: call?.error ? 'error' : 'ok', error: call?.error ?? null,
        latencyMs: Date.now() - started, usage: call ? [call.usage] : [], input: { goal, prompt: call?.prompt }, output: call?.error ? undefined : { read },
    }, slot)

    if (read?.model) {
        // Kept only while the goal is still the text read: a save since then reads its own
        const { error: keepError } = await admin.from('user_profiles')
            .update({ training_goal_read: read })
            .eq('user_id', user.id)
            .eq('training_goal', profile.training_goal!)
        if (keepError) reportError('goal-read', keepError, { userId: user.id, context: { step: 'keep' } })
    }
    return NextResponse.json({ read })
}
