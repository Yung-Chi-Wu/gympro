import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSecret } from './secrets'
import type { AiRecommendation, TrainingPeriodSummary } from './types'

let cachedClient: SupabaseClient | null = null

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

// Calls the get_period_training_summary RPC to fetch all objective facts
// about the user's training for this period. volumeSplit / strengthIndex /
// routineAdherence come back empty here — they're filled in separately by
// computeStrengthIndex / computeVolumeSplit / fetchRoutineAdherence, since
// each needs its own extra queries beyond what this single RPC does.
export async function fetchTrainingPeriodSummary(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    periodEnd: string
): Promise<TrainingPeriodSummary> {
    const { data, error } = await supabase.rpc('get_period_training_summary', {
        p_user_id: userId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
    })

    if (error) {
        throw new Error(`Failed to fetch training period summary: ${error.message}`)
    }

    return {
        ...(data as Omit<TrainingPeriodSummary, 'volumeSplit' | 'strengthIndex' | 'routineAdherence'>),
        volumeSplit: {},
        strengthIndex: {},
        routineAdherence: { followedRoutines: [], missedRoutines: [] },
    }
}

// Finds the most recently completed report before this period, whatever
// its actual length was — period length isn't fixed anymore, so we can't
// just subtract a fixed number of days to find "the previous one".
export async function fetchPreviousPeriod(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string
): Promise<{
    contextSummary: string | null
    previousStrengthIndex: Record<string, { currentIndex: number }> | null
}> {
    const { data, error } = await supabase
        .from('period_reports')
        .select('context_summary, recommendation')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .lt('period_start', periodStart)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (error) {
        throw new Error(`Failed to fetch previous period: ${error.message}`)
    }

    const recommendation = data?.recommendation as
        | { strengthIndex?: Record<string, { currentIndex: number }> }
        | null

    return {
        contextSummary: data?.context_summary ?? null,
        previousStrengthIndex: recommendation?.strengthIndex ?? null,
    }
}

export async function saveRecommendation(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    recommendation: AiRecommendation,
    userNote: string | null
): Promise<void> {
    const { contextSummary, ...recommendationJson } = recommendation

    const { error } = await supabase.from('period_reports').upsert(
        {
            user_id: userId,
            period_start: periodStart,
            status: 'completed',
            recommendation: recommendationJson,
            context_summary: contextSummary,
            user_note: userNote,
            completed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,period_start' }
    )

    if (error) {
        throw new Error(`Failed to save recommendation: ${error.message}`)
    }
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
        },
        { onConflict: 'user_id,period_start' }
    )

    if (error) {
        console.error('Failed to save insufficient_data status:', error.message)
    }
}

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

// ---------- Routine adherence, computed from real data, not the template ----------
// "Followed" a day means: that calendar day had a scheduled routine, AND
// at least one real workout_sets row was logged that day. A workouts row
// existing with zero sets (e.g. a leftover empty rest-day interaction)
// does NOT count as followed — that's the exact bug we hit and fixed on
// the dashboard, and the same principle applies here.
interface CycleDayRow {
    day_index: number
    routine_id: string | null
    routines: { name: string } | null
}

export async function fetchRoutineAdherence(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    periodEnd: string
): Promise<{ followedRoutines: string[]; missedRoutines: string[] }> {
    const { data: cycle } = await supabase
        .from('training_cycles')
        .select('id, cycle_length, start_date')
        .eq('user_id', userId)
        .maybeSingle()

    if (!cycle) {
        // Regular (non-Pro) users have no schedule to check adherence against.
        return { followedRoutines: [], missedRoutines: [] }
    }

    const { data: cycleDays } = await supabase
        .from('cycle_days')
        .select('day_index, routine_id, routines ( name )')
        .eq('training_cycle_id', cycle.id)

    const routineNameByDayIndex = new Map<number, string | null>()
    for (const day of (cycleDays as unknown as CycleDayRow[]) ?? []) {
        routineNameByDayIndex.set(day.day_index, day.routines?.name ?? null)
    }

    const { data: workoutsInPeriod } = await supabase
        .from('workouts')
        .select('id, performed_at')
        .eq('user_id', userId)
        .gte('performed_at', `${periodStart}T00:00:00Z`)
        .lte('performed_at', `${periodEnd}T23:59:59Z`)

    const workoutIds = (workoutsInPeriod ?? []).map((w) => w.id)
    const { data: setsInPeriod } =
        workoutIds.length > 0
            ? await supabase.from('workout_sets').select('workout_id').in('workout_id', workoutIds)
            : { data: [] as { workout_id: string }[] }

    const workoutIdsWithSets = new Set((setsInPeriod ?? []).map((s) => s.workout_id))
    const loggedDates = new Set(
        (workoutsInPeriod ?? [])
            .filter((w) => workoutIdsWithSets.has(w.id))
            .map((w) => w.performed_at.split('T')[0])
    )

    const followedRoutines: string[] = []
    const missedRoutines: string[] = []

    const cursor = new Date(`${periodStart}T00:00:00Z`)
    const end = new Date(`${periodEnd}T00:00:00Z`)
    const cycleStart = new Date(`${cycle.start_date}T00:00:00Z`)

    while (cursor <= end) {
        const dateStr = cursor.toISOString().split('T')[0]
        const daysSinceStart = Math.floor((cursor.getTime() - cycleStart.getTime()) / 86_400_000)
        const dayIndex =
            (((daysSinceStart % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1
        const routineName = routineNameByDayIndex.get(dayIndex)

        if (routineName) {
            if (loggedDates.has(dateStr)) {
                followedRoutines.push(routineName)
            } else {
                missedRoutines.push(routineName)
            }
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1)
    }

    return { followedRoutines, missedRoutines }
}

// ---------- Strength index, per muscle group ----------
// Each exercise's "current" value is the best estimated 1RM logged
// anywhere in this period. Its "baseline" is the estimated 1RM from the
// very first non-warmup set of that exercise this user ever logged.
// The index is currentBest / baseline * 100, averaged across every
// exercise trained in that muscle group this period.
interface SetWithExercise {
    exercise_id: string
    reps: number
    weight_kg: number
}

interface AllTimeSetRow {
    exercise_id: string
    reps: number
    weight_kg: number
    workouts: { performed_at: string } | null
}
function estimateOneRepMax(weightKg: number, reps: number): number {
    return weightKg * (1 + reps / 30)
}

export async function computeStrengthIndex(
    supabase: SupabaseClient,
    userId: string,
    periodStart: string,
    periodEnd: string,
    previousStrengthIndex: Record<string, { currentIndex: number }> | null
): Promise<Record<string, { currentIndex: number; previousIndex: number | null }>> {
    const { data: workoutsInPeriod } = await supabase
        .from('workouts')
        .select('id')
        .eq('user_id', userId)
        .gte('performed_at', `${periodStart}T00:00:00Z`)
        .lte('performed_at', `${periodEnd}T23:59:59Z`)

    const workoutIds = (workoutsInPeriod ?? []).map((w) => w.id)
    if (workoutIds.length === 0) return {}

    const { data: periodSets } = await supabase
        .from('workout_sets')
        .select('exercise_id, reps, weight_kg')
        .eq('user_id', userId)
        .eq('is_warmup', false)
        .in('workout_id', workoutIds)

    const bestByExercise = new Map<string, number>()
    for (const s of (periodSets as SetWithExercise[]) ?? []) {
        const oneRm = estimateOneRepMax(s.weight_kg, s.reps)
        const current = bestByExercise.get(s.exercise_id) ?? 0
        if (oneRm > current) bestByExercise.set(s.exercise_id, oneRm)
    }

    const exerciseIds = [...bestByExercise.keys()]
    if (exerciseIds.length === 0) return {}

    const { data: allTimeSets } = await supabase
        .from('workout_sets')
        .select('exercise_id, reps, weight_kg, workouts ( performed_at )')
        .eq('user_id', userId)
        .eq('is_warmup', false)
        .in('exercise_id', exerciseIds)

    const earliestByExercise = new Map<string, { date: string; oneRm: number }>()
    for (const s of (allTimeSets as unknown as AllTimeSetRow[]) ?? []) {
        if (!s.workouts) continue
        const date = s.workouts.performed_at
        const existing = earliestByExercise.get(s.exercise_id)
        if (!existing || date < existing.date) {
            earliestByExercise.set(s.exercise_id, {
                date,
                oneRm: estimateOneRepMax(s.weight_kg, s.reps),
            })
        }
    }

    const { data: exerciseInfo } = await supabase
        .from('exercises')
        .select('id, muscle_group')
        .in('id', exerciseIds)

    const muscleGroupByExercise = new Map(
        ((exerciseInfo ?? []) as { id: string; muscle_group: string }[]).map((e) => [
            e.id,
            e.muscle_group,
        ])
    )

    const indexSums = new Map<string, { total: number; count: number }>()
    for (const [exerciseId, currentBest] of bestByExercise.entries()) {
        const baseline = earliestByExercise.get(exerciseId)
        if (!baseline || baseline.oneRm <= 0) continue

        const index = (currentBest / baseline.oneRm) * 100
        const muscleGroup = muscleGroupByExercise.get(exerciseId) ?? 'other'

        const entry = indexSums.get(muscleGroup) ?? { total: 0, count: 0 }
        entry.total += index
        entry.count += 1
        indexSums.set(muscleGroup, entry)
    }

    const result: Record<string, { currentIndex: number; previousIndex: number | null }> = {}
    for (const [muscleGroup, { total, count }] of indexSums.entries()) {
        result[muscleGroup] = {
            currentIndex: Math.round(total / count),
            previousIndex: previousStrengthIndex?.[muscleGroup]?.currentIndex ?? null,
        }
    }

    return result
}