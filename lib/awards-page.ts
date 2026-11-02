import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
import { reportError } from './report-error'
import type { AwardsPage } from './awards'

// 紀錄's 成就 tab reads everything it shows in one request: awards_page (migration 20261102120000)
// returns the sets that could be bests, their exercises and the weekly reports' sessions, and
// lib/awards.ts works the medals out from them in the user's zone and unit.

/** awards_page's answer, or null when it failed, which is reported */
export async function readAwardsPage(supabase: SupabaseClient<Database>, userId: string): Promise<AwardsPage | null> {
    const { data, error } = await supabase.rpc('awards_page', undefined, { get: true })
    if (error || !data) {
        reportError('awards-page', error ?? new Error('awards_page returned nothing'), { userId })
        return null
    }
    return data as unknown as AwardsPage
}
