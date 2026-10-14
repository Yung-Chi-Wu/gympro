import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { loadUserToday } from '@/lib/ronnie/context'
import { appendConversation, loadConversation } from '@/lib/ronnie/conversation'
import { createAdminClient } from '@/lib/supabase/admin'
import { eventForDisplay, eventForModel, type RonnieEvent } from '@/lib/ronnie/events'
import { MAX_ROUTINE_NAME_CHARS } from '@/lib/text-limits'

// After a plan card's routines were saved in Coach G's editor (save-routine): { planId, language }.
// Writes it into today's conversation, so Ronnie knows the user's routines are now that plan. Only
// for a card in today's conversation, and only once the user's routines are that card's: Ronnie
// trusts an app event as something that happened.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const planId = String(body?.planId ?? '')
    const zh = body?.language === 'zh-TW'
    if (!UUID.test(planId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    const { today } = await loadUserToday(supabase, user.id)
    const { display } = await loadConversation(supabase, user.id, today)
    const card = display.flatMap((d) => (d.kind === 'assistant' ? d.plans ?? [] : [])).find((p) => p.id === planId)
    if (!card) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // A second tap, or another tab: already told
    if (display.some((d) => d.kind === 'event' && d.planId === planId)) return NextResponse.json({ status: 'already' })

    // The routines saved are named as the card's, in either language (save-routine cuts long names)
    const names = new Set(card.routines.flatMap((r) => [r.name, r.name_zh_tw].filter((n): n is string => !!n).map((n) => n.slice(0, MAX_ROUTINE_NAME_CHARS))))
    const { data: routines, error } = await supabase.from('routines').select('name').eq('user_id', user.id).order('created_at')
    if (error) {
        console.error('Plan card: routines not read:', error.message)
        return NextResponse.json({ error: 'Could not check the routines' }, { status: 500 })
    }
    if (!routines?.length || !routines.every((r) => names.has(r.name))) return NextResponse.json({ error: 'Not saved' }, { status: 409 })

    const event: RonnieEvent = { kind: 'plan_saved', routineNames: routines.map((r) => r.name) }
    const text = eventForDisplay(event, zh)
    const saveError = await appendConversation(createAdminClient(), user.id, today, {
        messages: [{ role: 'user', content: eventForModel(event) }],
        display: [{ kind: 'event', text, planId }],
    })
    if (saveError) console.error('Ronnie event not saved:', saveError)
    return NextResponse.json({ status: 'saved', text })
}
