import 'server-only'
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportError } from '@/lib/report-error'
import { askForSlot, spendLimitsFrom, type Refusal } from './spend-limits'

// The app's only way to the model: a client comes with a slot from the spend limits
// (lib/ai/spend-limits.ts), so a route can't call the model without asking. The slot goes to
// traceAfterResponse, which lets it go once the trace is saved. CI checks that nothing else in
// the app makes a client or reads the key (scripts/check-ai-spend.ts).

export interface AiSlot {
    client: Anthropic
    /** Lets the slot go; traceAfterResponse calls it after saving the trace. Never throws; a second call does nothing. */
    release: () => Promise<void>
}

/** Once an hour at most from each server instance, so a run of refusals isn't a run of rows */
let allReportedAt = 0
const ALL_REPORT_MS = 3_600_000

/** A slot and a model client for one AI request of this user, or why not. Never throws. */
export async function takeAiSlot(userId: string, clientOptions: Omit<ClientOptions, 'apiKey'> = {}): Promise<{ slot: AiSlot; refused?: never } | { refused: Refusal; slot?: never }> {
    const admin = createAdminClient()
    const limits = spendLimitsFrom(process.env)
    const asked = await askForSlot(userId, {
        rpc: admin ? (fn, args) => admin.rpc(fn, args) : null,
        limits,
        // An end that fails costs nothing: the slot frees itself
        failed: (err, step) => reportError('ai-spend', err, { userId, context: { step }, level: step === 'end' ? 'warning' : 'error' }),
        allReached: () => {
            if (Date.now() - allReportedAt < ALL_REPORT_MS) return
            allReportedAt = Date.now()
            reportError('ai-spend', `All users' AI requests reached US$${limits.allUsd} over 24 hours: they are refused until it falls under`)
        },
    })
    if (!asked.ok) return { refused: asked.refused }
    return { slot: { client: new Anthropic({ ...clientOptions, apiKey: process.env.ANTHROPIC_API_KEY! }), release: asked.release } }
}

/** A refused request's response: 429, with Retry-After when the time is known */
export function refusedResponse(refused: Refusal) {
    const seconds = refused.reason === 'busy' ? 5
        : refused.resetsAt ? Math.max(1, Math.ceil((Date.parse(refused.resetsAt) - Date.now()) / 1000)) : null
    return NextResponse.json(
        { error: 'AI limit', reason: refused.reason, resetsAt: refused.resetsAt },
        { status: 429, headers: seconds ? { 'Retry-After': String(seconds) } : {} },
    )
}
