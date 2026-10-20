import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { loadUserToday } from '@/lib/ronnie/context'
import { loadConversation } from '@/lib/ronnie/conversation'
import { flagAfterResponse } from '@/lib/ai/trace-after'

// 👎 on one of Ronnie's replies: { traceId }. Flags that reply's trace (thumbs_down), which keeps
// it for review. Only a reply in the user's own conversation today, so no one flags another's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const traceId = String(body?.traceId ?? '')
    if (!UUID.test(traceId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    const { today } = await loadUserToday(supabase, user.id)
    const { display } = await loadConversation(supabase, user.id, today)
    if (!display.some((d) => d.kind === 'assistant' && d.traceId === traceId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    flagAfterResponse([{ traceId, userId: user.id, kind: 'thumbs_down' }])
    return NextResponse.json({ ok: true })
}
