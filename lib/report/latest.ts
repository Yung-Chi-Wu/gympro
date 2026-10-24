import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/types/database.types'
import { shownStatus } from './queue'

export type ReportStatus = 'idle' | 'pending' | 'completed' | 'insufficient_data' | 'failed'

export interface LatestReport {
    status: ReportStatus
    /** The report itself, once it is completed */
    recommendation: Json | null
    periodStart: string
}

/**
 * The newest report as Today shows it. The page reads it with everything else, so the card
 * comes with the page instead of a line of text that turns into the report a moment later;
 * the card reads it again while a report is being written and after a retry.
 */
export async function loadLatestReport(supabase: SupabaseClient<Database>, userId: string): Promise<LatestReport | null> {
    const { data } = await supabase
        .from('period_reports')
        .select('status, recommendation, period_start, queued_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (!data) return null
    return {
        // A pending report whose run died shows as failed, with its retry
        status: shownStatus(data) as ReportStatus,
        recommendation: data.status === 'completed' ? data.recommendation : null,
        periodStart: data.period_start,
    }
}
