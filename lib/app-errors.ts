import type { SupabaseClient } from '@supabase/supabase-js'

// A failure the app server hit outside an AI call, as a row of app_errors (migration
// 20261015120000): AI calls are traced in ai_traces, with their own alarms. The hourly scheduler
// Lambda counts the past hour's errors into the gympro-app-errors alarm. Reported from routes and
// actions with reportError (lib/report-error.ts), from errors no code caught by
// instrumentation.ts, and from the browser through POST /api/errors (lib/report-client-error.ts),
// with a client/ source. Nothing here throws: a failure that can't be saved is logged instead.

export const MAX_ERROR_MESSAGE_CHARS = 1000
export const MAX_SOURCE_CHARS = 100
const MAX_CONTEXT_VALUE_CHARS = 200
const MAX_CONTEXT_KEYS = 10

/** error: something broke, and it alarms; warning: kept for a look, no alarm */
export type ErrorLevel = 'error' | 'warning'
/** A few short facts for finding the error (a status, a route): never the user's own text */
export type ErrorContext = Record<string, string | number | boolean | null | undefined>

export interface AppErrorRow {
    level: ErrorLevel
    source: string
    message: string
    user_id: string | null
    context: Record<string, string | number | boolean | null> | null
    app_version: string | null
}

/** The message of anything thrown or returned as an error: an Error, a Supabase error ({ message, code }) or anything else */
export function errorMessageOf(err: unknown): string {
    if (err instanceof Error) return err.message || err.name
    if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
        const code = 'code' in err && typeof err.code === 'string' && err.code ? ` (${err.code})` : ''
        return `${err.message}${code}`
    }
    return typeof err === 'string' ? err : JSON.stringify(err) ?? String(err)
}

/** The row for one failure, every field cut to what the table takes */
export function appErrorRow(level: ErrorLevel, source: string, err: unknown, { userId = null, context = {} }: { userId?: string | null; context?: ErrorContext } = {}): AppErrorRow {
    const facts = Object.entries(context)
        .filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined)
        .slice(0, MAX_CONTEXT_KEYS)
        .map(([k, v]) => [k.slice(0, 50), typeof v === 'string' ? v.slice(0, MAX_CONTEXT_VALUE_CHARS) : v])
    return {
        level,
        source: source.slice(0, MAX_SOURCE_CHARS) || 'unknown',
        message: errorMessageOf(err).slice(0, MAX_ERROR_MESSAGE_CHARS) || '(no message)',
        user_id: userId,
        context: facts.length ? Object.fromEntries(facts) : null,
        app_version: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    }
}

/** Saves one row with the service-role client; logs instead of throwing when it can't */
export async function saveAppError(admin: SupabaseClient | null, row: AppErrorRow): Promise<void> {
    if (!admin) {
        console.error('App error not saved: SUPABASE_SERVICE_ROLE_KEY is not set')
        return
    }
    try {
        const { error } = await admin.from('app_errors').insert(row)
        if (error) console.error(`App error not saved: ${error.message}`)
    } catch (err) {
        console.error('App error not saved:', err)
    }
}
