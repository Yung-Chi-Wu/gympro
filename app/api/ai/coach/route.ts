import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { buildSystemPrompt } from '@/lib/ronnie/prompt'
import { createRonnieExecutor } from '@/lib/ronnie/executor'
import { recentHistory, RONNIE_MODEL, runRonnieTurn } from '@/lib/ronnie/agent'
import { nextKnowledgeKey } from '@/lib/ronnie/citations'
import { loadRonnieContext, loadUserToday } from '@/lib/ronnie/context'
import {
    MAX_MESSAGE_CHARS,
    appendConversation,
    deleteConversation,
    deleteOldConversations,
    loadConversation,
    replaceConversation,
    truncateAtUserMessage,
    withProposalStatuses,
} from '@/lib/ronnie/conversation'
import { asTypedMessage } from '@/lib/ronnie/events'
import { createAdminClient } from '@/lib/supabase/admin'
import { errorText, usageOfError } from '@/lib/ai/trace'
import { refusedResponse, takeAiSlot } from '@/lib/ai/model-client'
import { flagAfterResponse, traceAfterResponse } from '@/lib/ai/trace-after'
import { flagForClear, flagsForMessage } from '@/lib/ronnie/signals'
import { reportError } from '@/lib/report-error'
import { isStorableText } from '@/lib/text-limits'

// Ronnie lives in lib/ronnie so the eval can run the same agent against fixture
// data; this route authenticates, keeps the day's conversation on the server, and
// wires the agent to the user's Supabase data.
//   GET     today's conversation, for the chat window
//   POST    { message, language, editFrom? } - one user message; editFrom replaces
//           the user's message at that index and everything after it
//   DELETE  clears today's conversation
// Each reply keeps its trace's id, so what the user does next can flag it (lib/ronnie/signals.ts):
// a correction, an edit, a clear right after it. A message past the spend limits
// (lib/ai/spend-limits.ts) is answered 429 and not kept.

// Vercel's limit for the route, which after() shares (the trace and the slot's release run in it).
// The turn stops at TURN_MS so they have time; each model call gives up after a minute and a half
// and retries once, so a stalled call can't hold the user's slot (lib/ai/spend-limits.ts).
export const maxDuration = 300
const TURN_MS = 240_000
const RONNIE_CLIENT = { timeout: 90_000, maxRetries: 1 }

async function authed() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return { supabase, user }
}

export async function GET() {
    const { supabase, user } = await authed()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { today } = await loadUserToday(supabase, user.id)
    const { display } = await loadConversation(supabase, user.id, today)
    return NextResponse.json({ items: await withProposalStatuses(supabase, display) })
}

export async function DELETE() {
    const { supabase, user } = await authed()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { today } = await loadUserToday(supabase, user.id)
    // Cleared right after a reply: that reply may be why
    const { display } = await loadConversation(supabase, user.id, today)
    await deleteConversation(supabase, user.id, today)
    flagAfterResponse(flagForClear(display, user.id))
    return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
    const { supabase, user } = await authed()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const language = body?.language === 'zh-TW' ? 'zh-TW' : 'en'
    let message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) return NextResponse.json({ error: 'Empty message' }, { status: 400 })
    if (message.length > MAX_MESSAGE_CHARS) return NextResponse.json({ error: 'Message too long' }, { status: 413 })
    if (!isStorableText(message)) return NextResponse.json({ error: 'Message has characters that cannot be saved' }, { status: 400 })
    message = asTypedMessage(message)

    // The conversation is written with the service role only (lib/ronnie/conversation.ts)
    const admin = createAdminClient()
    const ctx = await loadRonnieContext(supabase, user.id, language)
    let conv = await loadConversation(supabase, user.id, ctx.today)
    // Asked before anything is written, so a refused message changes nothing
    const { slot, refused } = await takeAiSlot(user.id, RONNIE_CLIENT)
    if (refused) return refusedResponse(refused)
    const editFrom = Number.isInteger(body?.editFrom) ? Number(body.editFrom) : null
    // What this message says about the replies before it: a correction, or an edit that replaces one
    flagAfterResponse(flagsForMessage(conv.display, message, editFrom, user.id))
    if (editFrom != null) {
        conv = truncateAtUserMessage(conv, editFrom)
        const error = await replaceConversation(admin, user.id, ctx.today, conv)
        if (error) {
            reportError('ronnie/edit', error, { userId: user.id })
            await slot.release()
            return NextResponse.json({ error: 'Could not edit the conversation' }, { status: 500 })
        }
    }

    const system = buildSystemPrompt(language, ctx.userContext)
    const executor = createRonnieExecutor({
        data: ctx.data, language, timeZone: ctx.timeZone, todayRoutineName: ctx.todayRoutineName,
        weightUnit: ctx.userContext.weightUnit === 'lb' ? 'lb' : 'kg',
        distanceUnit: ctx.distanceUnit,
        // Past the keys earlier search results today gave, which the model may still see
        knowledgeKeyStart: nextKnowledgeKey(conv.messages),
    })
    // Today's conversation so far, its newest turns when it is long (agent.ts)
    const history = recentHistory(conv.messages)
    const sent = [...history, { role: 'user' as const, content: message }]
    // The trace keeps what Ronnie was given: the system prompt with the user's context, and the history sent
    const traceInput = { language, message, editFrom, system, history, ...(history.length < conv.messages.length ? { olderNotSent: conv.messages.length - history.length } : {}) }
    const started = Date.now()
    // Made here, so the reply can carry it before the trace is written after the response
    const traceId = crypto.randomUUID()

    try {
        // Stop in the chat window closes the request, and TURN_MS stops it too: the agent then stops
        // between steps, and what it already changed is saved with the conversation instead of being lost
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TURN_MS)])
        const turn = await runRonnieTurn({ client: slot.client, system, messages: sent, executor, language, signal })
        const proposals = executor.proposals.map((p) => ({ ...p, status: 'pending' as const }))
        const recommendations = executor.recommendations
        const plans = executor.plans
        const reply = {
            kind: 'assistant' as const,
            text: turn.message,
            traceId,
            at: new Date().toISOString(),
            ...(proposals.length ? { proposals } : {}),
            ...(recommendations.length ? { recommendations } : {}),
            ...(plans.length ? { plans } : {}),
            ...(turn.sources?.length ? { sources: turn.sources } : {}),
            ...(turn.unsourced ? { unsourced: true } : {}),
        }
        // Only what this turn added: the user's message and everything after it
        const error = await appendConversation(admin, user.id, ctx.today, {
            messages: turn.messages.slice(history.length),
            display: [{ kind: 'user', text: message }, reply],
        })
        if (error) reportError('ronnie/conversation-save', error, { userId: user.id })
        await deleteOldConversations(supabase, user.id, ctx.today)
        traceAfterResponse({
            id: traceId, userId: user.id, feature: 'ronnie', model: RONNIE_MODEL, servedModel: turn.servedModel,
            // A turn cut short after a change is saved and answered, and traced as the error it was
            ...(turn.interrupted ? { status: 'error' as const, error: `${turn.interrupted.reason}: ${turn.interrupted.error}` } : { status: 'ok' as const }),
            latencyMs: Date.now() - started, usage: turn.usage, input: traceInput,
            // What the turn added after the user's message: tool calls, their results, the reply
            output: {
                reply: turn.message, messages: turn.messages.slice(sent.length), proposals, recommendations, plans, reloadDashboard: turn.reloadDashboard,
                ...(turn.replyCheck ? { replyCheck: turn.replyCheck } : {}),
                ...(turn.sources?.length ? { sources: turn.sources } : {}),
                ...(turn.unsourced ? { unsourced: true } : {}),
                ...(turn.knowledgeCheck ? { knowledgeCheck: turn.knowledgeCheck } : {}),
                ...(turn.medicineNoted ? { medicineNoted: true } : {}),
            },
            // A check fired: what the first draft claimed (done exercises, research the notes don't
            // support, a source key no note had), the draft, and whether the retry fixed it; or a
            // reply about a medicine sent them to no doctor or pharmacist, so code said it
            flags: turn.replyCheck || turn.knowledgeCheck?.retried || turn.knowledgeCheck?.unknownKeys?.length || turn.medicineNoted
                ? [{ kind: 'reply_check' as const, detail: {
                    ...(turn.replyCheck ?? {}),
                    ...(turn.knowledgeCheck?.retried || turn.knowledgeCheck?.unknownKeys?.length ? { knowledge: turn.knowledgeCheck } : {}),
                    ...(turn.medicineNoted ? { medicineNoted: true } : {}),
                } }]
                : [],
        }, slot)

        return NextResponse.json({ message: turn.message, reloadDashboard: turn.reloadDashboard, proposals, recommendations, plans, sources: turn.sources ?? [], unsourced: !!turn.unsourced, traceId, at: reply.at })
    } catch (err) {
        // The text only: the error carries the turn's tool calls, which hold the user's own data
        console.error('Ronnie error:', errorText(err))
        const partial = err as { servedModel?: string | null; toolCalls?: unknown }
        traceAfterResponse({
            userId: user.id, feature: 'ronnie', model: RONNIE_MODEL, servedModel: partial.servedModel ?? null, status: 'error', error: errorText(err),
            latencyMs: Date.now() - started, usage: usageOfError(err), input: traceInput, output: { toolCalls: partial.toolCalls ?? [] },
        }, slot)
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}
