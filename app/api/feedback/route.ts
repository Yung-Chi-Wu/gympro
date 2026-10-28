import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { MAX_FEEDBACK_PER_DAY, parseFeedback, userAgentOf } from '@/lib/feedback'
import { insertUnderLimit } from '@/lib/insert-under-limit'
import { reportError } from '@/lib/report-error'

// Feedback from Settings (lib/feedback.ts): POST { kind, message, language }, kept in app_feedback
// for the owner with the app version and the browser's user agent. Signed-in users only, and a few
// a day: past MAX_FEEDBACK_PER_DAY in 24 hours (Ronnie's exercise requests count too), a user's
// feedback is refused, so one browser can't fill the table, even with requests sent all at once
// (lib/insert-under-limit.ts).

const DAY_MS = 86_400_000

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const feedback = parseFeedback(await request.json().catch(() => null))
    if (!feedback) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    // app_feedback is the service role's only
    const admin = createAdminClient()
    if (!admin) {
        reportError('feedback', 'SUPABASE_SERVICE_ROLE_KEY is not set', { userId: user.id })
        return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
    }
    const since = new Date(Date.now() - DAY_MS).toISOString()
    const saved = await insertUnderLimit({
        insert: () => admin.from('app_feedback').insert({
            user_id: user.id,
            kind: feedback.kind,
            message: feedback.message,
            language: feedback.language,
            user_agent: userAgentOf(request.headers.get('user-agent')),
            app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 64) ?? null,
        }).select('id').single(),
        count: () => admin.from('app_feedback').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since),
        remove: (id) => admin.from('app_feedback').delete().eq('id', id),
        max: MAX_FEEDBACK_PER_DAY,
    })
    if (saved === 'limit') return NextResponse.json({ error: 'Too many' }, { status: 429 })
    if (saved !== 'saved') {
        reportError('feedback/save', saved.error, { userId: user.id })
        return NextResponse.json({ error: 'Not saved' }, { status: 500 })
    }
    return new Response(null, { status: 204 })
}
