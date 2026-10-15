import 'server-only'
import { after } from 'next/server'
import { appErrorRow, saveAppError, type ErrorContext, type ErrorLevel } from './app-errors'
import { createAdminClient } from './supabase/admin'

/**
 * Reports a failure from a route handler or a server action (lib/app-errors.ts): logged to
 * Vercel now, saved to app_errors after the response is sent, so it adds no wait. An AI call's
 * failure is traced in ai_traces instead. A warning is kept without alarming.
 */
export function reportError(source: string, err: unknown, options: { userId?: string | null; context?: ErrorContext; level?: ErrorLevel } = {}): void {
    const row = appErrorRow(options.level ?? 'error', source, err, options)
    console.error(`[${row.source}]`, err)
    const save = () => saveAppError(createAdminClient(), row)
    try {
        after(save)
    } catch {
        // Outside a request, where after() can't run: saved right away
        void save()
    }
}
