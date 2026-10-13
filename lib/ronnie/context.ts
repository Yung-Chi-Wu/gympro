import { timeZoneOf } from '@/lib/time-zone'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { createSupabaseRonnieData, type RonnieData } from './data'
import { memoryLines, type MemoryNote } from './memory'
import type { RonnieUserContext } from './prompt'
import { dateGuide } from './time'
import { vercelQueryEmbedder } from '../embeddings'

export interface RonnieContext {
    data: RonnieData
    timeZone: string
    todayRoutineName: string | null
    userContext: RonnieUserContext
    /** km or mi, for the treadmill sets in tool results */
    distanceUnit: 'km' | 'mi'
    /** The user's local date (YYYY-MM-DD): one conversation per day. */
    today: string
}

/** The user's local date, for routes that only need to know which day's conversation to use. */
export async function loadUserToday(supabase: SupabaseClient<Database>, userId: string): Promise<{ today: string; timeZone: string }> {
    const { data } = await supabase.from('user_profiles').select('timezone').eq('user_id', userId).maybeSingle()
    const timeZone = timeZoneOf(data?.timezone)
    return { today: dateGuide(new Date(), timeZone).today, timeZone }
}

/**
 * What every Ronnie request needs about the user, read with their own (RLS) client. language is
 * the reply's, for the notes in the prompt; null for a request that builds no prompt, which then
 * doesn't read them.
 */
export async function loadRonnieContext(supabase: SupabaseClient<Database>, userId: string, language: string | null): Promise<RonnieContext> {
    const [profileResult, cycleResult] = await Promise.all([
        supabase.from('user_profiles')
            .select('display_name, training_goal, weight_unit, distance_unit, timezone')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase.from('training_cycles')
            .select('id, cycle_length, start_date')
            .eq('user_id', userId)
            .maybeSingle(),
    ])
    const profile = profileResult.data
    const cycle = cycleResult.data
    const timeZone = timeZoneOf(profile?.timezone)
    // Memory notes are backend-only: read and written with the service role, for this user only
    const data = createSupabaseRonnieData(supabase, userId, timeZone, cycle, { embedQuery: vercelQueryEmbedder(), memory: createAdminClient() })

    const [todayRoutineName, notes] = await Promise.all([
        (async () => {
            const routineId = cycle ? await data.getTodayRoutineId() : null
            return routineId ? await data.getRoutineName(routineId) : null
        })(),
        // Without its notes Ronnie still answers; it just doesn't know what it was told before
        language === null ? [] : data.listMemories().catch((err): MemoryNote[] => {
            console.error('Ronnie memory notes not read:', err)
            return []
        }),
    ])
    const dates = dateGuide(new Date(), timeZone)

    // The names of the exercises the notes are about, read with the user's own client, so only
    // exercises they can see are named (a deleted custom one drops out of the prompt)
    const exerciseIds = [...new Set(notes.flatMap((n) => (n.kind === 'exercise' && n.subject ? [n.subject] : [])))]
    const { data: noted } = exerciseIds.length
        ? await supabase.from('exercises').select('id, name, name_zh_tw').in('id', exerciseIds)
        : { data: [] }
    const names = new Map((noted ?? []).map((e) => [e.id, e]))

    return {
        data,
        timeZone,
        todayRoutineName,
        distanceUnit: profile?.distance_unit === 'mi' ? 'mi' : 'km',
        today: dates.today,
        userContext: {
            displayName: profile?.display_name ?? null,
            goal: profile?.training_goal ?? null,
            todayRoutineName,
            weightUnit: profile?.weight_unit ?? 'kg',
            timezone: timeZone,
            dates,
            notes: memoryLines(notes, (id) => {
                const e = names.get(id)
                return e ? (language === 'zh-TW' && e.name_zh_tw ? e.name_zh_tw : e.name) : null
            }, timeZone),
        },
    }
}
