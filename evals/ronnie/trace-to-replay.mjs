// Turns a conversation into a replay for check-replays.mjs: what the user said, and what the
// model did and said, with exercise IDs written as @ and the fixture's library name, so the
// replay runs on the fixture whatever IDs the conversation had. The expectations are added by
// hand. Takes an eval trace (.claude/hillclimb/<flow>/<variant>/traces/<case>_rep<n>.json):
//   node evals/ronnie/trace-to-replay.mjs <trace.json> <replay id> > evals/ronnie/replays/<replay id>.json
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { EXERCISES } = createRequire(import.meta.url)(join(here, 'dist', 'check.cjs'))
const [tracePath, id] = process.argv.slice(2)
if (!tracePath || !id) {
    console.error('usage: node evals/ronnie/trace-to-replay.mjs <trace.json> <replay id>')
    process.exit(2)
}

const trace = JSON.parse(readFileSync(tracePath, 'utf8'))
const byShortId = (value) => {
    const found = EXERCISES.filter((e) => e.id.startsWith(String(value)))
    return found.length === 1 ? `@${found[0].name}` : value
}
const users = trace.filter((m) => m.role === 'user')
if (users.length !== 1) {
    console.error(`one user message per replay; this trace has ${users.length}`)
    process.exit(2)
}
const model = trace.flatMap((m) => {
    if (m.role === 'tool_call') {
        const { input } = JSON.parse(m.content)
        return [{ tool: m.name, input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, /exercise_id$/.test(k) ? byShortId(v) : v])) }]
    }
    return m.role === 'assistant' ? [{ reply: m.content }] : []
})
console.log(JSON.stringify({ id, source: tracePath.replace(/^.*\.claude\/hillclimb\//, ''), why: '', language: 'zh-TW', user: users[0].content, model, expect: {} }, null, 2))
