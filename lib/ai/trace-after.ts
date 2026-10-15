import { after } from 'next/server'
import { appErrorRow, saveAppError } from '@/lib/app-errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordTrace, type Trace } from './trace'

// For route handlers: saves the trace after the response is sent, so it adds no wait for the user.
// A trace that can't be saved is an app error: the AI alarms count traces, so without them they
// would see a quiet hour.
export function traceAfterResponse(trace: Omit<Trace, 'appVersion'>) {
    after(async () => {
        const admin = createAdminClient()
        if (!admin) return console.error('AI trace not saved: SUPABASE_SERVICE_ROLE_KEY is not set')
        const error = await recordTrace(admin, { ...trace, appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null })
        if (error) await saveAppError(admin, appErrorRow('error', 'ai-trace', error, { userId: trace.userId, context: { feature: trace.feature } }))
    })
}
