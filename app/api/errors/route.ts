import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { appErrorRow, saveAppError } from '@/lib/app-errors'
import { insertUnderLimit } from '@/lib/insert-under-limit'
import { parseClientErrorReport } from '@/lib/report-client-error'
import { reportError } from '@/lib/report-error'

// A failure in the browser (lib/report-client-error.ts): POST { source, message, context? },
// kept in app_errors like the server's own, so it alarms too. Signed-in users only, and a few
// at a time: past MAX_REPORTS_PER_WINDOW in 10 minutes, a user's reports are refused, so one
// browser can't fill the table, even with reports sent all at once (lib/insert-under-limit.ts).
// The answer is a status only, never the error back.

const WINDOW_MS = 10 * 60_000
const MAX_REPORTS_PER_WINDOW = 20

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const report = parseClientErrorReport(await request.json().catch(() => null))
    if (!report) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    // app_errors is the service role's only; without the key, saveAppError logs that it can't save
    const admin = createAdminClient()
    const row = appErrorRow('error', report.source, report.message, { userId: user.id, context: report.context })
    if (!admin) {
        await saveAppError(admin, row)
        return new Response(null, { status: 204 })
    }
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const saved = await insertUnderLimit({
        insert: () => admin.from('app_errors').insert(row).select('id').single(),
        count: () => admin.from('app_errors').select('id', { count: 'exact', head: true }).eq('user_id', user.id).like('source', 'client/%').gte('created_at', since),
        remove: (id) => admin.from('app_errors').delete().eq('id', id),
        max: MAX_REPORTS_PER_WINDOW,
    })
    if (saved === 'limit') return NextResponse.json({ error: 'Too many reports' }, { status: 429 })
    if (saved !== 'saved') {
        // Not kept: an uncounted route would let one browser fill the table
        reportError('client-errors/save', saved.error, { userId: user.id })
        return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
    }
    return new Response(null, { status: 204 })
}
