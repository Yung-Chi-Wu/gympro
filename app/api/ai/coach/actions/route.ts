import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { loadUserToday } from '@/lib/ronnie/context'
import { appendConversation } from '@/lib/ronnie/conversation'
import type { RoutineProposal } from '@/lib/ronnie/data'
import { eventForDisplay, eventForModel, type ResolvedRow } from '@/lib/ronnie/events'

// Confirm or Cancel on one of Ronnie's proposal cards: { actionId, decision, language }.
// The database applies it (resolve_ronnie_action: once, only if pending and
// unexpired, only the user's own routines). The removal's second confirmation is
// the chat window's dialog; this is called after it. Then the outcome is written
// into today's conversation, so Ronnie knows what the user did.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ResolveResult {
    status: 'confirmed' | 'cancelled' | 'expired' | 'not_found' | 'invalid' | 'pending'
    already_resolved?: boolean
    removed?: ResolvedRow[]
    added?: ResolvedRow[]
}

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const actionId = String(body?.actionId ?? '')
    const decision = body?.decision
    const zh = body?.language === 'zh-TW'
    if (!UUID.test(actionId) || (decision !== 'confirm' && decision !== 'cancel')) {
        return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('resolve_ronnie_action', { p_action_id: actionId, p_decision: decision })
    if (error) {
        console.error('resolve_ronnie_action failed:', error)
        return NextResponse.json({ error: 'Could not apply the change' }, { status: 500 })
    }
    const result = data as unknown as ResolveResult
    if (result.status === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (result.status === 'invalid') return NextResponse.json({ status: 'invalid' }, { status: 409 })
    // A second tap, or another tab: already done, nothing new to tell Ronnie
    if (result.already_resolved) return NextResponse.json({ status: result.status, alreadyResolved: true })

    const { data: row } = await supabase.from('ronnie_pending_actions').select('action').eq('id', actionId).maybeSingle()
    const status = result.status === 'pending' ? 'expired' : result.status
    const event = {
        kind: 'proposal' as const,
        status,
        proposal: row?.action as unknown as RoutineProposal,
        rows: result.removed ?? result.added ?? [],
    }
    const text = eventForDisplay(event, zh)
    const { today } = await loadUserToday(supabase, user.id)
    const saveError = await appendConversation(supabase, today, {
        messages: [{ role: 'user', content: eventForModel(event, zh) }],
        display: [{ kind: 'event', text }],
    })
    if (saveError) console.error('Ronnie event not saved:', saveError)

    return NextResponse.json({ status, text, reloadDashboard: status === 'confirmed' && event.rows.length > 0 })
}
