import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from '../../lib/ronnie/prompt'
import { createRonnieExecutor } from '../../lib/ronnie/executor'
import { runRonnieTurn, RONNIE_MODEL, type RonnieTurn } from '../../lib/ronnie/agent'
import { getSecret } from '../../lambda/ai-worker/src/secrets'
import { createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, ROUTINES, type FixtureWrite } from './fixture'
import type { RoutineProposal } from '../../lib/ronnie/data'
import { eventForModel } from '../../lib/ronnie/events'
import { dot, SEARCH_EMBEDDING_MODEL } from '../../lib/embeddings'
import { exerciseDocument } from '../../lib/ronnie/search'
import { cachedEmbedder } from '../shared/embedding-cache'
import { join } from 'node:path'

// Bundled by `npm run eval:ronnie:build` into dist/ronnie.cjs for run-eval.mjs.
// Runs the production Ronnie code (lib/ronnie) against the fixture user.

export { RONNIE_MODEL, EXERCISES, ROUTINES, FIXTURE_USER, FIXTURE_NOW, FIXTURE_TIME_ZONE, buildSystemPrompt, createFixtureData, createRonnieExecutor }

let client: Anthropic | null = null

/** Same key as the Lambda, read from SSM (/gympro/anthropic-api-key). */
export async function getClient(): Promise<Anthropic> {
    client ??= new Anthropic({ apiKey: await getSecret(process.env.ANTHROPIC_API_KEY_PARAM ?? '/gympro/anthropic-api-key') })
    return client
}

/**
 * Vector search over the fixture library with the production model. The production
 * RPC does the same thing in SQL. Embeddings are cached in .cache/, so a query Ronnie
 * repeats across reps is paid for once.
 */
let embedTexts: ReturnType<typeof cachedEmbedder> | null = null
let docVectors: Promise<number[][]> | null = null

function fixtureNearest() {
    // One embedder for the whole run, so parallel conversations share one cache
    embedTexts ??= cachedEmbedder(join(process.cwd(), 'evals', 'ronnie', '.cache'), SEARCH_EMBEDDING_MODEL)
    const embedder = embedTexts
    return async (query: string) => {
        docVectors ??= embedder(EXERCISES.map((e) => exerciseDocument(e)), 'document')
        const docs = await docVectors
        const [q] = await embedder([query], 'query')
        return EXERCISES
            .map((e, i) => ({ id: e.id, score: dot(q, docs[i]) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 50)
            .map((x) => x.id)
    }
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
    vectors = !injectedClient,
}: {
    model?: string
    language: string
    turns: CaseTurn[]
    /** For tests: a stand-in for the Claude client */
    client?: Anthropic
    /** Vector search as in production; off for offline tests, which make no AWS calls */
    vectors?: boolean
}): Promise<ConversationResult> {
    const anthropic = injectedClient ?? await getClient()
    const { data, writes, proposals, applyProposal } = createFixtureData({ nearest: vectors ? fixtureNearest() : undefined })
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
            const text = eventForModel({ kind: 'proposal', status: user.event === 'confirm' ? 'confirmed' : 'cancelled', proposal, rows })
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
            weightUnit: FIXTURE_USER.weightUnit === 'lb' ? 'lb' : 'kg',
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
