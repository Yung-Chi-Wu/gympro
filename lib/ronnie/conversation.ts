import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '../types/database.types'
import type { PlannedRoutine } from '../coach-g'
import type { RoutineProposal } from './data'
import { EVENT_PREFIX } from './events'
import type { ReplySource } from './citations'

// Ronnie's conversation is kept on the server, one per user per local day
// (ronnie_conversations). messages is the full history the model gets back next
// time - tool calls and results included, so an ID looked up earlier is still
// there - and display is what the chat window shows. Kept 30 days.
// Only the server writes it, with the service-role client (lib/supabase/admin.ts) and always
// for the signed-in user: what is stored goes back to the model on every turn, so it must be
// what the user sent and what the tools returned. Users read and clear their own.

export type ProposalStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired'
export type ProposalCard = RoutineProposal & { id: string; status?: ProposalStatus }
export interface RecommendationCard {
    exerciseId: string
    exerciseName: string
    /** A swap card: the button replaces this exercise in today's workout with the recommended one */
    replacesExerciseId?: string
    replacesName?: string
}

/**
 * A week Coach G's planner built for Ronnie (plan_routines). Its button opens Coach G's editor
 * with these routines; saving there replaces the user's routines and cycle (save-routine).
 */
export interface PlanCard {
    id: string
    routines: PlannedRoutine[]
    cycleLength: number
}

export type DisplayItem =
    | { kind: 'user'; text: string }
    /** traceId: the reply's trace, which a signal or Report a mistake flags (lib/ronnie/signals.ts); at: when it was shown */
    /** sources: the papers the reply cites, as [1], [2] in its text; unsourced: it has general advice no note supports (citations.ts) */
    | { kind: 'assistant'; text: string; proposals?: ProposalCard[]; recommendations?: RecommendationCard[]; plans?: PlanCard[]; traceId?: string; at?: string; sources?: ReplySource[]; unsourced?: boolean }
    /** planId: the plan card this event is about, so the card shows it saved */
    | { kind: 'event'; text: string; planId?: string }

export interface Conversation {
    messages: Anthropic.MessageParam[]
    display: DisplayItem[]
}

const KEEP_DAYS = 30
/**
 * The longest message the user can send. What they send stays in the day's conversation and goes
 * back to the model on every later turn, so one pasted page would be paid for all day. The route
 * refuses a longer one instead of cutting it, so what Ronnie keeps is what the user sent.
 */
export const MAX_MESSAGE_CHARS = 2000

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

const NO_ADMIN = 'Conversation storage is not available'

/** Appends in one statement, so an app event written meanwhile is not overwritten. admin is the service-role client. */
export async function appendConversation(admin: Client | null, userId: string, date: string, add: Conversation): Promise<string | null> {
    if (!admin) return NO_ADMIN
    const { error } = await admin.rpc('append_ronnie_conversation_for', {
        p_user_id: userId,
        p_date: date,
        p_messages: add.messages as unknown as Json,
        p_display: add.display as unknown as Json,
    })
    return error?.message ?? null
}

/** admin is the service-role client */
export async function replaceConversation(admin: Client | null, userId: string, date: string, conv: Conversation): Promise<string | null> {
    if (!admin) return NO_ADMIN
    const { error } = await admin.from('ronnie_conversations').upsert({
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
