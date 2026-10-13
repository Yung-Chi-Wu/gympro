import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSecret } from './secrets'
import type { ReportV3 } from './report/types'
import { isCurrentRequest } from '../../../lib/report/queue'

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

/** One report request: the row it fills, and the queued_at its message carries (lib/report/queue.ts) */
export interface ReportRequest {
    userId: string
    periodStart: string
    queuedAt?: string
}

/**
 * Whether this request should run: its row is still pending, with this request's queued_at.
 * A redelivered message whose run already saved a result, or one a retry has replaced, is not.
 */
export async function isRunnable(supabase: SupabaseClient, request: ReportRequest): Promise<{ run: boolean; why: string }> {
    const { data, error } = await supabase
        .from('period_reports')
        .select('status, queued_at')
        .eq('user_id', request.userId)
        .eq('period_start', request.periodStart)
        .maybeSingle()
    if (error) throw new Error(`Failed to read the report row: ${error.message}`)
    if (!data) return { run: false, why: 'no report row' }
    if (data.status !== 'pending') return { run: false, why: `the report is ${data.status}` }
    if (!isCurrentRequest(data.queued_at, request.queuedAt)) return { run: false, why: 'a newer request replaced this one' }
    return { run: true, why: '' }
}

/**
 * Updates the row only while it is still this request's: pending, with its queued_at. Says
 * when nothing matched, which means a retry replaced this request while it ran.
 */
async function updateOwnRow(supabase: SupabaseClient, request: ReportRequest, values: Record<string, unknown>) {
    let query = supabase
        .from('period_reports')
        .update(values)
        .eq('user_id', request.userId)
        .eq('period_start', request.periodStart)
        .eq('status', 'pending')
    if (request.queuedAt) query = query.eq('queued_at', request.queuedAt)
    const { data, error } = await query.select('user_id')
    if (!error && !data?.length) console.warn(`Not saved (${String(values.status)}): the report for user ${request.userId}, period ${request.periodStart} is no longer this request's`)
    return { error }
}

/** A finished version 3 report. */
export async function saveReport(supabase: SupabaseClient, request: ReportRequest, report: ReportV3, userNote: string | null): Promise<void> {
    const { error } = await updateOwnRow(supabase, request, {
        status: 'completed',
        recommendation: report,
        context_summary: null,
        user_note: userNote,
        completed_at: new Date().toISOString(),
        pdf_status: 'not_applicable',
    })
    if (error) throw new Error(`Failed to save report: ${error.message}`)
}

export async function saveFailedStatus(supabase: SupabaseClient, request: ReportRequest, errorMessage: string): Promise<void> {
    const { error } = await updateOwnRow(supabase, request, { status: 'failed', error_message: errorMessage, pdf_status: 'not_applicable' })
    if (error) console.error('Failed to save failure status:', error.message)
}

export async function saveInsufficientDataStatus(
    supabase: SupabaseClient,
    request: ReportRequest,
    totalSets: number,
    minimumRequired: number
): Promise<void> {
    const { error } = await updateOwnRow(supabase, request, {
        status: 'insufficient_data',
        error_message: `Only ${totalSets} sets logged this period (minimum ${minimumRequired} required for analysis).`,
        pdf_status: 'not_applicable',
    })
    if (error) console.error('Failed to save insufficient_data status:', error.message)
}
