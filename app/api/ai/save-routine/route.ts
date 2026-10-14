import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseSaveRequest } from '@/lib/coach-g'
import { addDays, localDate, MAX_CYCLE_DAYS } from '@/lib/periods'
import { timeZoneOf } from '@/lib/time-zone'

// Saves Coach G's routines and cycle in place of the user's own: { routines, cycleLength,
// startDayIndex, language }. The whole replacement is one transaction (save_coach_routines,
// migration 20261014160000), so a failure leaves the user's routines as they were.

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Checked whole (lib/coach-g.ts): the card lets the user change sets and reps, nothing else
    const save = parseSaveRequest(await request.json().catch(() => null), MAX_CYCLE_DAYS)
    if ('error' in save) return NextResponse.json({ error: save.error }, { status: 400 })

    // Only exercises from the library the user can see
    const ids = [...new Set(save.routines.flatMap((r) => r.exercises.map((e) => e.exercise_id)))]
    const [{ data: known, error: exercisesError }, { data: profile }] = await Promise.all([
        ids.length ? supabase.from('exercises').select('id').in('id', ids) : Promise.resolve({ data: [], error: null }),
        supabase.from('user_profiles').select('timezone').eq('user_id', user.id).maybeSingle(),
    ])
    if (exercisesError) {
        console.error('Coach G save: exercises not read:', exercisesError.message)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    }
    if ((known ?? []).length !== ids.length) return NextResponse.json({ error: 'invalid' }, { status: 400 })

    // Today in the user's own time zone: the cycle started startDayIndex - 1 days before it
    const today = localDate(timeZoneOf(profile?.timezone), new Date())
    const startDate = addDays(today, -(save.startDayIndex - 1))

    const { data, error } = await supabase.rpc('save_coach_routines', {
        p_cycle_length: save.cycleLength,
        p_start_date: startDate,
        p_routines: save.routines,
    })
    if (error) {
        console.error('Coach G save failed:', error.message)
        return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    }
    const saved = data as { cycle_id: string; routines: { id: string; name: string }[] }
    return NextResponse.json({ success: true, routines: saved.routines, cycleId: saved.cycle_id })
}
