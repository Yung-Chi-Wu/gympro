import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSecret } from './secrets'
import type { ReportV3 } from './report/types'

let cachedClient: SupabaseClient | null = null

export async function getSupabaseClient(): Promise<SupabaseClient> {
    if (cachedClient) {
        return cachedClient
    }

    const supabaseUrl = process.env.SUPABASE_URL
    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL environment variable is not set')
    }

    const serviceRoleKeyParam = process.env.SUPABASE_SERVICE_ROLE_KEY_PARAM
    if (!serviceRoleKeyParam) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY_PARAM environment variable is not set')
    }

    const serviceRoleKey = await getSecret(serviceRoleKeyParam)

    cachedClient = createClient(supabaseUrl, serviceRoleKey)
    return cachedClient
}

/** A finished version 3 report. */
export async function saveReport(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    report: ReportV3,
    userNote: string | null
): Promise<void> {
    const { error } = await supabase.from('period_reports').upsert(
        {
            user_id: userId,
            period_start: periodStart,
            status: 'completed',
            recommendation: report,
            context_summary: null,
            user_note: userNote,
            completed_at: new Date().toISOString(),
            pdf_status: 'not_applicable',
        },
        { onConflict: 'user_id,period_start' }
    )
    if (error) throw new Error(`Failed to save report: ${error.message}`)
}

export async function saveFailedStatus(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    errorMessage: string
): Promise<void> {
    const { error } = await supabase.from('period_reports').upsert(
        {
            user_id: userId,
            period_start: periodStart,
            status: 'failed',
            error_message: errorMessage,
            pdf_status: 'not_applicable',
        },
        { onConflict: 'user_id,period_start' }
    )

    if (error) {
        console.error('Failed to save failure status:', error.message)
    }
}

export async function saveInsufficientDataStatus(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    totalSets: number,
    minimumRequired: number
): Promise<void> {
    const { error } = await supabase.from('period_reports').upsert(
        {
            user_id: userId,
            period_start: periodStart,
            status: 'insufficient_data',
            error_message: `Only ${totalSets} sets logged this period (minimum ${minimumRequired} required for analysis).`,
            pdf_status: 'not_applicable',
        },
        { onConflict: 'user_id,period_start' }
    )

    if (error) {
        console.error('Failed to save insufficient_data status:', error.message)
    }
}
