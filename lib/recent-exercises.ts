import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types/database.types'
import { reportError } from './report-error'

/** The latest sets read for the exercises done lately: a few weeks of training */
const RECENT_SETS = 300

/**
 * The exercises in the user's latest sets, the latest first, which the exercise picker lists at
 * the top of their group (lib/exercise-display.ts exerciseSections). A failed read gives none,
 * and the picker lists the group by equipment alone.
 */
export async function recentExerciseIds(supabase: SupabaseClient<Database>, userId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('workout_sets')
        .select('exercise_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(RECENT_SETS)
    if (error) {
        reportError('recent-exercises', error, { userId, level: 'warning' })
        return []
    }
    return [...new Set(data.map((s) => s.exercise_id))]
}

/** Each exercise with its place among the recent ones (0 the latest), if it is one */
export function withRecent<T extends { id: string }>(exercises: T[], recentIds: string[]): (T & { recent?: number })[] {
    const place = new Map(recentIds.map((id, i) => [id, i]))
    return exercises.map((ex) => (place.has(ex.id) ? { ...ex, recent: place.get(ex.id) } : ex))
}
