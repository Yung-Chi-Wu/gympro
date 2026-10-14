import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { buildSystemPrompt } from '@/lib/ronnie/prompt'
import { createRonnieExecutor } from '@/lib/ronnie/executor'
import { RONNIE_MODEL, runRonnieTurn } from '@/lib/ronnie/agent'
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
import { traceAfterResponse } from '@/lib/ai/trace-after'

// Ronnie lives in lib/ronnie so the eval can run the same agent against fixture
// data; this route authenticates, keeps the day's conversation on the server, and
// wires the agent to the user's Supabase data.
//   GET     today's conversation, for the chat window
//   POST    { message, language, editFrom? } - one user message; editFrom replaces
//           the user's message at that index and everything after it
//   DELETE  clears today's conversation

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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
    await deleteConversation(supabase, user.id, today)
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
    message = asTypedMessage(message)

    // The conversation is written with the service role only (lib/ronnie/conversation.ts)
    const admin = createAdminClient()
    const ctx = await loadRonnieContext(supabase, user.id, language)
    let conv = await loadConversation(supabase, user.id, ctx.today)
    if (Number.isInteger(body?.editFrom)) {
        conv = truncateAtUserMessage(conv, body.editFrom)
        const error = await replaceConversation(admin, user.id, ctx.today, conv)
        if (error) return NextResponse.json({ error: 'Could not edit the conversation' }, { status: 500 })
    }

    const system = buildSystemPrompt(language, ctx.userContext)
    const executor = createRonnieExecutor({
        data: ctx.data, language, timeZone: ctx.timeZone, todayRoutineName: ctx.todayRoutineName,
        weightUnit: ctx.userContext.weightUnit === 'lb' ? 'lb' : 'kg',
        distanceUnit: ctx.distanceUnit,
    })
    const sent = [...conv.messages, { role: 'user' as const, content: message }]
    // The trace keeps what Ronnie was given: the system prompt with the user's context, and today's conversation so far
    const traceInput = { language, message, editFrom: Number.isInteger(body?.editFrom) ? body.editFrom : null, system, history: conv.messages }
    const started = Date.now()

    try {
        // Stop in the chat window closes the request: the agent then stops between steps, and what it
        // already changed is saved with the conversation instead of being lost
        const turn = await runRonnieTurn({ client, system, messages: sent, executor, language, signal: request.signal })
        const proposals = executor.proposals.map((p) => ({ ...p, status: 'pending' as const }))
        const recommendations = executor.recommendations
        const reply = {
            kind: 'assistant' as const,
            text: turn.message,
            ...(proposals.length ? { proposals } : {}),
            ...(recommendations.length ? { recommendations } : {}),
        }
        // Only what this turn added: the user's message and everything after it
        const error = await appendConversation(admin, user.id, ctx.today, {
            messages: turn.messages.slice(conv.messages.length),
            display: [{ kind: 'user', text: message }, reply],
        })
        if (error) console.error('Ronnie conversation not saved:', error)
        await deleteOldConversations(supabase, user.id, ctx.today)
        traceAfterResponse({
            userId: user.id, feature: 'ronnie', model: RONNIE_MODEL, servedModel: turn.servedModel,
            // A turn cut short after a change is saved and answered, and traced as the error it was
            ...(turn.interrupted ? { status: 'error' as const, error: `${turn.interrupted.reason}: ${turn.interrupted.error}` } : { status: 'ok' as const }),
            latencyMs: Date.now() - started, usage: turn.usage, input: traceInput,
            // What the turn added after the user's message: tool calls, their results, the reply
            output: { reply: turn.message, messages: turn.messages.slice(sent.length), proposals, recommendations, reloadDashboard: turn.reloadDashboard },
        })

        return NextResponse.json({ message: turn.message, reloadDashboard: turn.reloadDashboard, proposals, recommendations })
    } catch (err) {
        console.error('Ronnie error:', err)
        const partial = err as { servedModel?: string | null; toolCalls?: unknown }
        traceAfterResponse({
            userId: user.id, feature: 'ronnie', model: RONNIE_MODEL, servedModel: partial.servedModel ?? null, status: 'error', error: errorText(err),
            latencyMs: Date.now() - started, usage: usageOfError(err), input: traceInput, output: { toolCalls: partial.toolCalls ?? [] },
        })
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}
