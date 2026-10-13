// What check-agent.mjs loads, bundled by it into dist/check.cjs. Kept apart from entry.ts, the paid
// eval's entry (part of its approved harness), so offline checks can grow without touching it.
export { runRonnieTurn } from '../../lib/ronnie/agent'
export { stripMarkdown } from '../../lib/ronnie/prompt'
export { createRonnieExecutor, MAX_REMOVALS_PER_TURN } from '../../lib/ronnie/executor'
export { createSupabaseRonnieData } from '../../lib/ronnie/data'
export { createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, ROUTINES } from './fixture'
