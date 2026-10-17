// Replays recorded conversations through Ronnie's current code, with no model call: what the
// model did and said comes from the recording (evals/ronnie/replays/*.json), and everything
// else - the tools on the fixture's data, the reply check, the lines the code writes - runs as
// it does in the app. A recorded mistake stays caught: if a change lets it through again, this
// fails. Free and offline, so it runs in CI on every pull request; whether the model still makes
// the mistake is the paid eval's question. New replays come from trace-to-replay.mjs.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
execFileSync(join(root, 'lambda/ai-worker/node_modules/.bin/esbuild'), ['evals/ronnie/check-entry.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=evals/ronnie/dist/check.cjs', '--log-level=warning'], { cwd: root, stdio: 'inherit' })
const {
    runRonnieTurn, createRonnieExecutor, createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, doneClaims, namesOf,
} = createRequire(import.meta.url)(join(here, 'dist', 'check.cjs'))

let failures = 0
const check = (cond, msg) => { if (!cond) { failures++; console.log(`FAIL ${msg}`) } else console.log(`ok   ${msg}`) }

// ---------- The rule, on sentences a reply could have ----------
{
    const today = [
        { names: namesOf(['槓鈴臥推', 'Barbell Bench Press']), done: true },
        { names: namesOf(['上斜啞鈴臥推', 'Incline Dumbbell Press']), done: false },
        { names: namesOf(['肩推', 'Overhead Press']), done: false },
    ]
    const cases = [
        ['你今天已經做過臥推和上斜臥推，前三角練得不少。', ['上斜啞鈴臥推']],
        ['上斜啞鈴臥推你今天都練過了。', ['上斜啞鈴臥推']],
        ['今天練了肩推，所以側平舉剛好。', ['肩推']],
        ["You've already done the bench press and the incline press, so your front delts are covered.", ['上斜啞鈴臥推']],
        ['You already trained the Incline Dumbbell Press today.', ['上斜啞鈴臥推']],
        ['你今天已經做過臥推，前三角有練到。', []],
        ['上斜臥推還沒做，等你做完再看要不要加。', []],
        ['今天的課表已經有上斜臥推，前三角會練到。', []],
        ['臥推和上斜臥推你都做過了嗎？', []],
        ['已經排了上斜臥推和肩推。', []],
        ["You haven't done the incline press yet; the bench press is done.", []],
        ['側平舉可以取代肩推。', []],
    ]
    const wrong = cases.filter(([text, want]) => doneClaims(text, today).join() !== want.join())
        .map(([text, want]) => `${text} -> ${doneClaims(text, today).join() || 'none'} (want ${want.join() || 'none'})`)
    check(!wrong.length, `the reply check reads ${cases.length} sentences right: done claims, questions, plans, negations, the longer name where one is inside another${wrong.length ? `\n       ${wrong.join('\n       ')}` : ''}`)
    check(namesOf(['上斜啞鈴臥推', 'Incline Dumbbell Press']).join('|') === '上斜啞鈴臥推|上斜臥推|Incline Dumbbell Press|Incline Press', `a name is also matched without its equipment: ${namesOf(['上斜啞鈴臥推', 'Incline Dumbbell Press']).join('|')}`)
}

// ---------- The replays ----------
const usage = { input_tokens: 10, output_tokens: 5 }
const idOf = (value) => {
    if (typeof value !== 'string' || !value.startsWith('@')) return value
    const found = EXERCISES.find((e) => e.name === value.slice(1))
    if (!found) throw new Error(`no fixture exercise named ${value.slice(1)}`)
    return found.id
}
const replays = readdirSync(join(here, 'replays')).filter((f) => f.endsWith('.json')).sort()
check(replays.length > 0, `replays to run (${replays.length})`)

for (const file of replays) {
    const r = JSON.parse(readFileSync(join(here, 'replays', file), 'utf8'))
    const problems = []
    if (file !== `${r.id}.json`) problems.push(`the file name isn't the id ${r.id}`)
    if (!r.why?.trim()) problems.push('no why')
    const recorded = r.model.map((step, i) => step.tool
        ? { stop_reason: 'tool_use', model: 'replay', usage, content: [{ type: 'tool_use', id: `r${i}`, name: step.tool, input: Object.fromEntries(Object.entries(step.input ?? {}).map(([k, v]) => [k, idOf(v)])) }] }
        : { stop_reason: 'end_turn', model: 'replay', usage, content: [{ type: 'text', text: step.reply }] })
    const lastReply = [...r.model].reverse().find((s) => s.reply)?.reply ?? ''
    // Asked to fix its reply, the model says what the replay recorded, or the same again
    const steps = [...recorded, { stop_reason: 'end_turn', model: 'replay', usage, content: [{ type: 'text', text: r.retry ?? lastReply }] }]
    const calls = []
    const client = { messages: { create: async (params) => {
        calls.push(params)
        const step = steps[calls.length - 1]
        if (!step) throw new Error('the replay ran out')
        return step
    } } }
    const { data, writes } = createFixtureData()
    const executor = createRonnieExecutor({ data, language: r.language, timeZone: FIXTURE_TIME_ZONE, todayRoutineName: FIXTURE_USER.todayRoutineName, now: () => FIXTURE_NOW })
    let t
    try {
        t = await runRonnieTurn({ client, system: 'replay', messages: [{ role: 'user', content: r.user }], executor, language: r.language })
    } catch (err) {
        problems.push(`the turn threw: ${err.message}`)
    }
    if (t) {
        const e = r.expect
        const claimed = t.replyCheck?.claimed ?? []
        if (e.claimed && claimed.join() !== e.claimed.join()) problems.push(`claimed ${claimed.join() || 'none'}, expected ${e.claimed.join() || 'none'}`)
        if (e.fixed !== undefined && t.replyCheck?.fixed !== e.fixed) problems.push(`fixed ${t.replyCheck?.fixed}, expected ${e.fixed}`)
        // The fix is asked for only when there is something to fix, and only once
        const asked = calls.filter((c) => c.messages.at(-1)?.content?.toString().startsWith('[App check]')).length
        if (asked !== (e.claimed?.length ? 1 : 0)) problems.push(`the model was asked to fix its reply ${asked} times`)
        for (const s of e.shownIncludes ?? []) if (!t.message.includes(s)) problems.push(`the reply shown lacks "${s}"`)
        for (const s of e.shownExcludes ?? []) if (t.message.includes(s)) problems.push(`the reply shown has "${s}"`)
        if (t.messages.some((m) => typeof m.content === 'string' && m.content.startsWith('[App check]'))) problems.push('the check was kept in the history')
        if (writes.length !== (e.writes ?? 0)) problems.push(`${writes.length} writes, expected ${e.writes ?? 0}`)
    }
    check(!problems.length, `${r.id}: ${r.why.slice(0, 90)}${problems.length ? `\n       ${problems.join('\n       ')}` : ''}`)
}

if (failures) {
    console.log(`\n${failures} check(s) failed`)
    process.exit(1)
}
console.log('\nEvery recorded conversation replays as expected')
