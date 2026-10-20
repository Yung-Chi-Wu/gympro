import 'server-only'
import { after } from 'next/server'
import { appErrorRow, saveAppError } from '@/lib/app-errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { flagTrace, recordTrace, type Trace, type TraceFlag } from './trace'

// For route handlers: saves the trace after the response is sent, so it adds no wait for the user.
// A trace that can't be saved is an app error: the AI alarms count traces, so without them they
// would see a quiet hour. Flags the trace already has (the reply check fired) are saved after it.
export function traceAfterResponse(trace: Omit<Trace, 'appVersion'> & { flags?: Omit<TraceFlag, 'traceId' | 'userId'>[] }) {
    const { flags = [], ...rest } = trace
    after(async () => {
        const admin = createAdminClient()
        if (!admin) return console.error('AI trace not saved: SUPABASE_SERVICE_ROLE_KEY is not set')
        const error = await recordTrace(admin, { ...rest, appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null })
        if (error) return saveAppError(admin, appErrorRow('error', 'ai-trace', error, { userId: trace.userId, context: { feature: trace.feature } }))
        if (rest.id) await flagAll(admin, flags.map((f) => ({ ...f, traceId: rest.id!, userId: rest.userId })))
    })
}

/** Flags earlier traces after the response is sent (a correction, an edit, a card cancelled, a report) */
export function flagAfterResponse(flags: TraceFlag[]) {
    if (!flags.length) return
    after(async () => {
        const admin = createAdminClient()
        if (!admin) return console.error('AI trace not flagged: SUPABASE_SERVICE_ROLE_KEY is not set')
        await flagAll(admin, flags)
    })
}

async function flagAll(admin: NonNullable<ReturnType<typeof createAdminClient>>, flags: TraceFlag[]) {
    for (const flag of flags) {
        const error = await flagTrace(admin, flag)
        // A lost flag loses a case, not the user's turn: logged as a warning, which no alarm counts
        if (error) await saveAppError(admin, appErrorRow('warning', 'ai-trace-flag', error, { userId: flag.userId, context: { kind: flag.kind } }))
    }
}
