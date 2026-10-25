import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { loadUserToday } from '@/lib/ronnie/context'
import { loadConversation } from '@/lib/ronnie/conversation'
import { flagAfterResponse } from '@/lib/ai/trace-after'
import { parseReport } from '@/lib/feedback'

// Report a mistake, under one of Ronnie's replies: { traceId, reasons?, note? } (lib/feedback.ts).
// Flags that reply's trace (reported), which keeps it for review, with the reasons the user picked
// and what they added. Only a reply in the user's own conversation today, so no one flags another's.

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const report = parseReport(await request.json().catch(() => null))
    if (!report) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    const { traceId, reasons, note } = report

    const { today } = await loadUserToday(supabase, user.id)
    const { display } = await loadConversation(supabase, user.id, today)
    if (!display.some((d) => d.kind === 'assistant' && d.traceId === traceId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    flagAfterResponse([{ traceId, userId: user.id, kind: 'reported', ...(reasons.length || note ? { detail: { reasons, note } } : {}) }])
    return NextResponse.json({ ok: true })
}
