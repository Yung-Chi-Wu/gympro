import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { appErrorRow, saveAppError } from '@/lib/app-errors'
import { parseClientErrorReport } from '@/lib/report-client-error'
import { reportError } from '@/lib/report-error'

// A failure in the browser (lib/report-client-error.ts): POST { source, message, context? },
// kept in app_errors like the server's own, so it alarms too. Signed-in users only, and a few
// at a time: from MAX_REPORTS_PER_WINDOW in 10 minutes on, a user's reports are refused, so one
// browser can't fill the table. The answer is a status only, never the error back.

const WINDOW_MS = 10 * 60_000
const MAX_REPORTS_PER_WINDOW = 20

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const report = parseClientErrorReport(await request.json().catch(() => null))
    if (!report) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    // This user's reports of the past 10 minutes. app_errors is the service role's only; without
    // the key there is nothing to count, and saveAppError logs that it can't save.
    const admin = createAdminClient()
    if (admin) {
        const { count, error } = await admin
            .from('app_errors')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .like('source', 'client/%')
            .gte('created_at', new Date(Date.now() - WINDOW_MS).toISOString())
        if (error) {
            // Not counted, not saved: an uncounted route would let one browser fill the table
            reportError('client-errors/count', error, { userId: user.id })
            return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
        }
        if ((count ?? 0) >= MAX_REPORTS_PER_WINDOW) return NextResponse.json({ error: 'Too many reports' }, { status: 429 })
    }

    await saveAppError(admin, appErrorRow('error', report.source, report.message, { userId: user.id, context: report.context }))
    return new Response(null, { status: 204 })
}
