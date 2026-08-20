import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSecret } from './secrets'
import type { StoredRecommendation } from './types'

let cachedClient: SupabaseClient | null = null

export async function getSupabaseClient(): Promise<SupabaseClient> {
    if (cachedClient) return cachedClient

    const supabaseUrl = process.env.SUPABASE_URL
    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL environment variable is not set')
    }

    const serviceRoleKey = await getSecret('gympro/supabase-service-role-key')
    cachedClient = createClient(supabaseUrl, serviceRoleKey)
    return cachedClient
}

export async function fetchReport(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string
): Promise<{ periodEnd: string; recommendation: StoredRecommendation }> {
    const { data, error } = await supabase
        .from('period_reports')
        .select('recommendation')
        .eq('user_id', userId)
        .eq('period_start', periodStart)
        .eq('status', 'completed')
        .maybeSingle()

    if (error) {
        throw new Error(`Failed to fetch report: ${error.message}`)
    }
    if (!data || !data.recommendation) {
        throw new Error(`No completed report found for user ${userId}, period ${periodStart}`)
    }

    return {
        periodEnd: periodStart, // display purposes only; exact end date isn't critical here
        recommendation: data.recommendation as unknown as StoredRecommendation,
    }
}

export async function markPdfStatus(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    status: 'completed' | 'failed'
): Promise<void> {
    const { error } = await supabase
        .from('period_reports')
        .update({ pdf_status: status })
        .eq('user_id', userId)
        .eq('period_start', periodStart)

    if (error) {
        console.error(`Failed to update pdf_status: ${error.message}`)
    }
}