import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from '../../lib/ronnie/prompt'
import { createRonnieExecutor } from '../../lib/ronnie/executor'
import { runRonnieTurn, RONNIE_MODEL, type RonnieTurn } from '../../lib/ronnie/agent'
import { getSecret } from '../../lambda/ai-worker/src/secrets'
import { createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, ROUTINES, type FixtureWrite } from './fixture'
import type { RoutineProposal } from '../../lib/ronnie/data'
import type { MemoryNote } from '../../lib/ronnie/memory'
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

/** A memory note as a case writes it: an exercise by its name, a joint by its id */
export interface CaseMemory {
    kind: MemoryNote['kind']
    subject: string | null
    state: string
    text: string
}

/** A case's memory note as the store holds it: an exercise by its fixture id. Unknown names stay as written. */
export function memoryNote(m: CaseMemory, updatedAt = '2026-10-01T02:00:00.000Z'): MemoryNote {
    const subject = m.kind === 'exercise' && m.subject ? EXERCISES.find((e) => e.name === m.subject)?.id ?? m.subject : m.subject
    return { kind: m.kind, subject, state: m.state, text: m.text, updatedAt }
}

export interface ConversationResult {
    system: string
    // writes: the changes made during that turn (an add before the user agreed shows up early);
    // events: app events recorded just before that turn's message; session: which conversation
    // (day) of the case it was in, from 1; memoryChanged: whether that turn changed the notes,
    // and memoryAfter the notes then (only when they changed)
    turns: (RonnieTurn & { user: string; events: string[]; writes: FixtureWrite[]; session: number; memoryChanged: boolean; memoryAfter?: MemoryNote[] })[]
    writes: FixtureWrite[]
    proposals: RoutineProposal[]
    /** The memory notes before the first conversation and after the last */
    memoriesBefore: MemoryNote[]
    memories: MemoryNote[]
}

/**
 * Plays the user's turns in order. The history carries over between turns with
 * tool calls and results included, as the server stores it, and so does the
 * database state. With sessions, each one is a new conversation (another day: the
 * history starts empty), while the data and the memory notes carry over.
 */
export async function runConversation({
    model = RONNIE_MODEL,
    language,
    turns = [],
    sessions = [turns],
    memory = [],
    client: injectedClient,
    vectors = !injectedClient,
}: {
    model?: string
    language: string
    turns?: CaseTurn[]
    /** Conversations on separate days, in order; replaces turns */
    sessions?: CaseTurn[][]
    /** What Ronnie remembers before the first conversation */
    memory?: CaseMemory[]
    /** For tests: a stand-in for the Claude client */
    client?: Anthropic
    /** Vector search as in production; off for offline tests, which make no AWS calls */
    vectors?: boolean
}): Promise<ConversationResult> {
    const anthropic = injectedClient ?? await getClient()
    const { data, writes, proposals, applyProposal, memories } = createFixtureData({
        nearest: vectors ? fixtureNearest() : undefined,
        memories: memory.map((m) => memoryNote(m)),
    })
    const memoriesBefore = memories.map((n) => ({ ...n }))
    const system = buildSystemPrompt(language, FIXTURE_USER)
    const results: ConversationResult['turns'] = []

    for (const [s, sessionTurns] of sessions.entries()) {
        let messages: Anthropic.MessageParam[] = []
        let events: string[] = []
        for (const user of sessionTurns) {
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
            const notesBefore = JSON.stringify(memories)
            const turn = await runRonnieTurn({ client: anthropic, system, messages, executor, language, model })
            messages = turn.messages
            const memoryChanged = JSON.stringify(memories) !== notesBefore
            results.push({
                user, events, ...turn, writes: writes.slice(writesBefore), session: s + 1, memoryChanged,
                ...(memoryChanged ? { memoryAfter: memories.map((n) => ({ ...n })) } : {}),
            })
            events = []
        }
    }
    return { system, turns: results, writes, proposals, memoriesBefore, memories: memories.map((n) => ({ ...n })) }
}
