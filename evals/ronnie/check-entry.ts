// What check-agent.mjs loads, bundled by it into dist/check.cjs. Kept apart from entry.ts, the paid
// eval's entry (part of its approved harness), so offline checks can grow without touching it.
export { runRonnieTurn } from '../../lib/ronnie/agent'
export { buildSystemPrompt, stripMarkdown } from '../../lib/ronnie/prompt'
export { MAX_EXERCISE_NOTES_SHOWN, MAX_NOTES, MAX_OTHER_NOTES, memoryLines } from '../../lib/ronnie/memory'
export { createRonnieExecutor, MAX_REMOVALS_PER_TURN } from '../../lib/ronnie/executor'
export { createSupabaseRonnieData } from '../../lib/ronnie/data'
export { appendConversation, replaceConversation } from '../../lib/ronnie/conversation'
export { asTypedMessage, EVENT_PREFIX } from '../../lib/ronnie/events'
export { createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, fixtureNotes, ROUTINES } from './fixture'
