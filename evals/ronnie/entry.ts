import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from '../../lib/ronnie/prompt'
import { createRonnieExecutor } from '../../lib/ronnie/executor'
import { runRonnieTurn, RONNIE_MODEL, type RonnieTurn } from '../../lib/ronnie/agent'
import { getSecret } from '../../lambda/ai-worker/src/secrets'
import { createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, ROUTINES, type FixtureWrite } from './fixture'

// Bundled by `npm run eval:ronnie:build` into dist/ronnie.cjs for run-eval.mjs.
// Runs the production Ronnie code (lib/ronnie) against the fixture user.

export { RONNIE_MODEL, EXERCISES, ROUTINES, FIXTURE_USER, buildSystemPrompt }

let client: Anthropic | null = null

/** Same key as the Lambda, read from SSM (/gympro/anthropic-api-key). */
export async function getClient(): Promise<Anthropic> {
    client ??= new Anthropic({ apiKey: await getSecret(process.env.ANTHROPIC_API_KEY_PARAM ?? '/gympro/anthropic-api-key') })
    return client
}

export interface ConversationResult {
    system: string
    // writes: the changes made during that turn (an add before the user agreed shows up early)
    turns: (RonnieTurn & { user: string; writes: FixtureWrite[] })[]
    writes: FixtureWrite[]
}

/**
 * Plays the user's turns in order, the way RonnieWidget does: each request
 * carries the earlier turns as plain text only (tool calls and results are not
 * sent back), and the database state carries over between turns.
 */
export async function runConversation({
    model = RONNIE_MODEL,
    language,
    turns,
}: {
    model?: string
    language: string
    turns: string[]
}): Promise<ConversationResult> {
    const anthropic = await getClient()
    const { data, writes } = createFixtureData()
    const system = buildSystemPrompt(language, FIXTURE_USER)
    const messages: Anthropic.MessageParam[] = []
    const results: ConversationResult['turns'] = []

    for (const user of turns) {
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
        messages.push({ role: 'assistant', content: turn.message })
        results.push({ user, ...turn, writes: writes.slice(writesBefore) })
    }
    return { system, turns: results, writes }
}
