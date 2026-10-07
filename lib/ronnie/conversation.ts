import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../types/database.types'
import type { RoutineProposal } from './data'
import { EVENT_PREFIX } from './events'

// Ronnie's conversation is kept on the server, one per user per local day
// (ronnie_conversations). messages is the full history the model gets back next
// time - tool calls and results included, so an ID looked up earlier is still
// there - and display is what the chat window shows. Kept 30 days.

export type ProposalStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired'
export type ProposalCard = RoutineProposal & { id: string; status?: ProposalStatus }
export interface RecommendationCard {
    exerciseId: string
    exerciseName: string
}

export type DisplayItem =
    | { kind: 'user'; text: string }
    | { kind: 'assistant'; text: string; proposals?: ProposalCard[]; recommendations?: RecommendationCard[] }
    | { kind: 'event'; text: string }

export interface Conversation {
    messages: Anthropic.MessageParam[]
    display: DisplayItem[]
}

const KEEP_DAYS = 30

type Client = SupabaseClient<Database>

export async function loadConversation(supabase: Client, userId: string, date: string): Promise<Conversation> {
    const { data } = await supabase
        .from('ronnie_conversations')
        .select('messages, display')
        .eq('user_id', userId)
        .eq('conversation_date', date)
        .maybeSingle()
    return {
        messages: (data?.messages ?? []) as unknown as Anthropic.MessageParam[],
        display: (data?.display ?? []) as unknown as DisplayItem[],
    }
}

/** Appends in one statement, so an app event written meanwhile is not overwritten. */
export async function appendConversation(supabase: Client, date: string, add: Conversation): Promise<string | null> {
    const { error } = await supabase.rpc('append_ronnie_conversation', {
        p_date: date,
        p_messages: add.messages as unknown as Json,
        p_display: add.display as unknown as Json,
    })
    return error?.message ?? null
}

export async function replaceConversation(supabase: Client, userId: string, date: string, conv: Conversation): Promise<string | null> {
    const { error } = await supabase.from('ronnie_conversations').upsert({
        user_id: userId,
        conversation_date: date,
        messages: conv.messages as unknown as Json,
        display: conv.display as unknown as Json,
        updated_at: new Date().toISOString(),
    })
    return error?.message ?? null
}

export async function deleteConversation(supabase: Client, userId: string, date: string): Promise<void> {
    await supabase.from('ronnie_conversations').delete().eq('user_id', userId).eq('conversation_date', date)
}

/** Deletes the user's conversations older than 30 days. */
export async function deleteOldConversations(supabase: Client, userId: string, today: string): Promise<void> {
    const cutoff = new Date(`${today}T00:00:00Z`)
    cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS)
    await supabase.from('ronnie_conversations').delete().eq('user_id', userId).lt('conversation_date', cutoff.toISOString().slice(0, 10))
}

// A message the user typed: an app event is also a user-role string, but carries the prefix
const isTyped = (m: Anthropic.MessageParam) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith(EVENT_PREFIX)

/**
 * Cuts the conversation before the user's n-th message (0-based), for editing an
 * earlier message: the answer to it and everything after are dropped.
 */
export function truncateAtUserMessage(conv: Conversation, n: number): Conversation {
    const messageIdx = conv.messages.map((m, i) => (isTyped(m) ? i : -1)).filter((i) => i >= 0)[n]
    const displayIdx = conv.display.map((d, i) => (d.kind === 'user' ? i : -1)).filter((i) => i >= 0)[n]
    if (messageIdx === undefined || displayIdx === undefined) return conv
    return { messages: conv.messages.slice(0, messageIdx), display: conv.display.slice(0, displayIdx) }
}

/** Adds each proposal card's current status, read from ronnie_pending_actions. */
export async function withProposalStatuses(supabase: Client, display: DisplayItem[]): Promise<DisplayItem[]> {
    const ids = display.flatMap((d) => (d.kind === 'assistant' ? (d.proposals ?? []).map((p) => p.id) : []))
    if (!ids.length) return display
    const { data } = await supabase.from('ronnie_pending_actions').select('id, status, expires_at').in('id', ids)
    const now = Date.now()
    const status = new Map((data ?? []).map((r) => [
        r.id,
        (r.status === 'pending' && Date.parse(r.expires_at) < now ? 'expired' : r.status) as ProposalStatus,
    ]))
    return display.map((d) => d.kind === 'assistant' && d.proposals
        ? { ...d, proposals: d.proposals.map((p) => ({ ...p, status: status.get(p.id) ?? 'expired' })) }
        : d)
}
