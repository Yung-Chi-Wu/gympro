import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from '../../lib/ronnie/prompt'
import { createRonnieExecutor } from '../../lib/ronnie/executor'
import { runRonnieTurn, RONNIE_MODEL, type RonnieTurn } from '../../lib/ronnie/agent'
import { getSecret } from '../../lambda/ai-worker/src/secrets'
import { createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, ROUTINES, type FixtureWrite } from './fixture'
import type { RoutineProposal } from '../../lib/ronnie/data'
import { eventForModel } from '../../lib/ronnie/events'

// Bundled by `npm run eval:ronnie:build` into dist/ronnie.cjs for run-eval.mjs.
// Runs the production Ronnie code (lib/ronnie) against the fixture user.

export { RONNIE_MODEL, EXERCISES, ROUTINES, FIXTURE_USER, buildSystemPrompt }

let client: Anthropic | null = null

/** Same key as the Lambda, read from SSM (/gympro/anthropic-api-key). */
export async function getClient(): Promise<Anthropic> {
    client ??= new Anthropic({ apiKey: await getSecret(process.env.ANTHROPIC_API_KEY_PARAM ?? '/gympro/anthropic-api-key') })
    return client
}

/** A user message, or the user tapping Confirm / Cancel on the latest proposal card. */
export type CaseTurn = string | { event: 'confirm' | 'cancel' }

export interface ConversationResult {
    system: string
    // writes: the changes made during that turn (an add before the user agreed shows up early);
    // events: app events recorded just before that turn's message
    turns: (RonnieTurn & { user: string; events: string[]; writes: FixtureWrite[] })[]
    writes: FixtureWrite[]
    proposals: RoutineProposal[]
}

/**
 * Plays the user's turns in order. The history carries over between turns with
 * tool calls and results included, as the server stores it, and so does the
 * database state.
 */
export async function runConversation({
    model = RONNIE_MODEL,
    language,
    turns,
    client: injectedClient,
}: {
    model?: string
    language: string
    turns: CaseTurn[]
    /** For tests: a stand-in for the Claude client */
    client?: Anthropic
}): Promise<ConversationResult> {
    const anthropic = injectedClient ?? await getClient()
    const { data, writes, proposals, applyProposal } = createFixtureData()
    const system = buildSystemPrompt(language, FIXTURE_USER)
    let messages: Anthropic.MessageParam[] = []
    const results: ConversationResult['turns'] = []
    let events: string[] = []

    for (const user of turns) {
        if (typeof user !== 'string') {
            // As the actions API does it: apply (on confirm), then record the event in the history
            const proposal = proposals.at(-1)
            if (!proposal) throw new Error(`app event "${user.event}" but Ronnie made no proposal to act on`)
            const rows = user.event === 'confirm' ? applyProposal(proposal) : []
            const text = eventForModel({ kind: 'proposal', status: user.event === 'confirm' ? 'confirmed' : 'cancelled', proposal, rows }, language === 'zh-TW')
            messages.push({ role: 'user', content: text })
            events.push(text)
            continue
        }
        messages.push({ role: 'user', content: user })
        // A fresh executor per request, as in the coach route
        const executor = createRonnieExecutor({
            data,
            language,
            timeZone: FIXTURE_TIME_ZONE,
            todayRoutineName: FIXTURE_USER.todayRoutineName,
            now: () => FIXTURE_NOW,
        })
        const writesBefore = writes.length
        const turn = await runRonnieTurn({ client: anthropic, system, messages, executor, language, model })
        messages = turn.messages
        results.push({ user, events, ...turn, writes: writes.slice(writesBefore) })
        events = []
    }
    return { system, turns: results, writes, proposals }
}
