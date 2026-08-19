import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSecret } from './secrets'
import type { AiRecommendation, WeeklyTrainingSummary } from './types'

let cachedClient: SupabaseClient | null = null

// Creates (or reuses, on a warm Lambda) an authenticated Supabase client.
// Uses the service_role key, which bypasses RLS — this is safe here
// because this code only ever runs inside our own Lambda, never
// exposed to end users.
export async function getSupabaseClient(): Promise<SupabaseClient> {
    if (cachedClient) {
        return cachedClient
    }

    const supabaseUrl = process.env.SUPABASE_URL
    if (!supabaseUrl) {
        throw new Error('SUPABASE_URL environment variable is not set')
    }

    const serviceRoleKey = await getSecret('gympro/supabase-service-role-key')

    cachedClient = createClient(supabaseUrl, serviceRoleKey)
    return cachedClient
}

// Calls the get_weekly_training_summary RPC function to fetch all
// objective facts about the user's training week.
export async function fetchWeeklyTrainingSummary(
    supabase: SupabaseClient,
    userId: string,
    weekStart: string
): Promise<WeeklyTrainingSummary> {
    const { data, error } = await supabase.rpc('get_weekly_training_summary', {
        p_user_id: userId,
        p_week_start: weekStart,
    })

    if (error) {
        throw new Error(`Failed to fetch weekly training summary: ${error.message}`)
    }

    return data as WeeklyTrainingSummary
}

// Fetches the context_summary from the previous week's recommendation,
// if one exists, to give Claude continuity across weeks.
export async function fetchPreviousContextSummary(
    supabase: SupabaseClient,
    userId: string,
    weekStart: string
): Promise<string | null> {
    const previousWeekStart = new Date(weekStart)
    previousWeekStart.setDate(previousWeekStart.getDate() - 7)
    const previousWeekStartIso = previousWeekStart.toISOString().split('T')[0]

    const { data, error } = await supabase
        .from('ai_recommendations')
        .select('context_summary')
        .eq('user_id', userId)
        .eq('week_start', previousWeekStartIso)
        .maybeSingle()

    if (error) {
        throw new Error(`Failed to fetch previous context summary: ${error.message}`)
    }

    return data?.context_summary ?? null
}

// Writes the finished recommendation back to the database.
// Uses upsert so this is safe to re-run (idempotent) if the same
// week is ever processed twice (manual trigger + scheduled trigger
// both landing on the same week, for example).
export async function saveRecommendation(
    supabase: SupabaseClient,
    userId: string,
    weekStart: string,
    recommendation: AiRecommendation,
    userNote: string | null
): Promise<void> {
    const { contextSummary, ...recommendationJson } = recommendation

    const { error } = await supabase.from('ai_recommendations').upsert(
        {
            user_id: userId,
            week_start: weekStart,
            status: 'completed',
            recommendation: recommendationJson,
            context_summary: contextSummary,
            user_note: userNote,
            completed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,week_start' }
    )

    if (error) {
        throw new Error(`Failed to save recommendation: ${error.message}`)
    }
}

// Marks a recommendation as failed, so it's visible for debugging
// instead of silently disappearing.
export async function saveFailedStatus(
    supabase: SupabaseClient,
    userId: string,
    weekStart: string,
    errorMessage: string
): Promise<void> {
    const { error } = await supabase.from('ai_recommendations').upsert(
        {
            user_id: userId,
            week_start: weekStart,
            status: 'failed',
            error_message: errorMessage,
        },
        { onConflict: 'user_id,week_start' }
    )

    if (error) {
        console.error('Failed to save failure status:', error.message)
    }
}

// Marks a recommendation as skipped due to insufficient data,
// so the user sees a clear reason instead of a low-value AI response.
export async function saveInsufficientDataStatus(
    supabase: SupabaseClient,
    userId: string,
    weekStart: string,
    totalSets: number,
    minimumRequired: number
): Promise<void> {
    const { error } = await supabase.from('ai_recommendations').upsert(
        {
            user_id: userId,
            week_start: weekStart,
            status: 'insufficient_data',
            error_message: `Only ${totalSets} sets logged this week (minimum ${minimumRequired} required for analysis).`,
        },
        { onConflict: 'user_id,week_start' }
    )

    if (error) {
        console.error('Failed to save insufficient_data status:', error.message)
    }
}

// Fetches the user's long-term training goal, if they've set one.
export async function fetchUserProfile(
    supabase: SupabaseClient,
    userId: string
): Promise<{ trainingGoal: string | null; ageYears: number | null; sex: string | null }> {
    const { data, error } = await supabase
        .from('user_profiles')
        .select('training_goal, date_of_birth, sex')
        .eq('user_id', userId)
        .maybeSingle()

    if (error) {
        throw new Error(`Failed to fetch user profile: ${error.message}`)
    }

    return {
        trainingGoal: data?.training_goal ?? null,
        ageYears: data?.date_of_birth ? calculateAge(data.date_of_birth) : null,
        sex: data?.sex ?? null,
    }
}

function calculateAge(dateOfBirth: string): number {
    const dob = new Date(dateOfBirth)
    const now = new Date()
    let age = now.getFullYear() - dob.getFullYear()
    const hasHadBirthdayThisYear =
        now.getMonth() > dob.getMonth() ||
        (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate())
    if (!hasHadBirthdayThisYear) age -= 1
    return age
}