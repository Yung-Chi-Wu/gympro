import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordTrace, type Trace } from './trace'

// For route handlers: saves the trace after the response is sent, so it adds no wait for the user.
export function traceAfterResponse(trace: Omit<Trace, 'appVersion'>) {
    after(async () => {
        const admin = createAdminClient()
        if (!admin) return console.error('AI trace not saved: SUPABASE_SERVICE_ROLE_KEY is not set')
        await recordTrace(admin, { ...trace, appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null })
    })
}
