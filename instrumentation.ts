import type { Instrumentation } from 'next'

// Errors no code caught, in a page, a route handler, a server action or the proxy: saved to
// app_errors like the ones code reports (lib/app-errors.ts), so they alarm too. Named by the
// route's file path, not the request's, which can carry the user's own values. Awaited, as Next
// asks of this hook.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
    const { appErrorRow, saveAppError } = await import('./lib/app-errors')
    const { createAdminClient } = await import('./lib/supabase/admin')
    const digest = typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined
    await saveAppError(createAdminClient(), appErrorRow('error', `uncaught/${context.routeType}`, err, {
        context: { route: context.routePath, method: request.method, digest },
    }))
}
