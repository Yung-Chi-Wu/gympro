import { timeZoneOf } from '@/lib/time-zone'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { createSupabaseRonnieData, type RonnieData } from './data'
import { memoryLines, type MemoryNote } from './memory'
import type { RonnieUserContext } from './prompt'
import { dateGuide } from './time'
import { isTransientAwsError, vercelQueryEmbedder } from '../embeddings'
import { reportError } from '../report-error'

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
    // Memory notes and proposals are backend-only: written with the service role, for this user only
    // Search goes on with keywords either way. A timeout or throttling passes by itself and is kept
    // as a warning; anything else (a role or model access that broke) alarms, since it stays broken.
    // On Vercel a missing role is the same breakage, so it's reported too.
    const embedQuery = vercelQueryEmbedder()
    if (!embedQuery && (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview')) reportError('ronnie/vector-search', new Error('AWS_ROLE_ARN is not set: search uses keywords only'), { userId })
    const data = createSupabaseRonnieData(supabase, userId, timeZone, cycle, {
        embedQuery,
        onSearchError: (err) => reportError('ronnie/vector-search', err, {
            userId, level: isTransientAwsError(err) ? 'warning' : 'error', context: { kind: (err as Error | null)?.name ?? 'unknown' },
        }),
        onWriteError: (what, err) => reportError(`ronnie/${what}`, err, { userId }),
        admin: createAdminClient(),
    })

    const [todayRoutineName, notes] = await Promise.all([
        (async () => {
            const routineId = cycle ? await data.getTodayRoutineId() : null
            return routineId ? await data.getRoutineName(routineId) : null
        })(),
        // Without its notes Ronnie still answers; it just doesn't know what it was told before
        language === null ? [] : data.listMemories().catch((err): MemoryNote[] => {
            reportError('ronnie/memory-read', err, { userId })
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
