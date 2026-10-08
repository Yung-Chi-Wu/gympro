import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { createSupabaseRonnieData, type RonnieData } from './data'
import type { RonnieUserContext } from './prompt'
import { dateGuide } from './time'

export interface RonnieContext {
    data: RonnieData
    timeZone: string
    todayRoutineName: string | null
    userContext: RonnieUserContext
    /** The user's local date (YYYY-MM-DD): one conversation per day. */
    today: string
}

/** The user's local date, for routes that only need to know which day's conversation to use. */
export async function loadUserToday(supabase: SupabaseClient<Database>, userId: string): Promise<{ today: string; timeZone: string }> {
    const { data } = await supabase.from('user_profiles').select('timezone').eq('user_id', userId).maybeSingle()
    const timeZone = data?.timezone ?? 'America/New_York'
    return { today: dateGuide(new Date(), timeZone).today, timeZone }
}

/** What every Ronnie request needs about the user, read with their own (RLS) client. */
export async function loadRonnieContext(supabase: SupabaseClient<Database>, userId: string): Promise<RonnieContext> {
    const [profileResult, cycleResult] = await Promise.all([
        supabase.from('user_profiles')
            .select('display_name, training_goal, weight_unit, timezone')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase.from('training_cycles')
            .select('id, cycle_length, start_date')
            .eq('user_id', userId)
            .maybeSingle(),
    ])
    const profile = profileResult.data
    const cycle = cycleResult.data
    const timeZone = profile?.timezone ?? 'America/New_York'
    const data = createSupabaseRonnieData(supabase, userId, timeZone, cycle)

    const routineId = cycle ? await data.getTodayRoutineId() : null
    const todayRoutineName = routineId ? await data.getRoutineName(routineId) : null
    const dates = dateGuide(new Date(), timeZone)

    return {
        data,
        timeZone,
        todayRoutineName,
        today: dates.today,
        userContext: {
            displayName: profile?.display_name ?? null,
            goal: profile?.training_goal ?? null,
            todayRoutineName,
            weightUnit: profile?.weight_unit ?? 'kg',
            timezone: timeZone,
            dates,
        },
    }
}
