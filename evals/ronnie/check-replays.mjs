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
    traceToDraft, replayProblems, fixtureExerciseFor, libraryRowFor, displayNameIn, UNMAPPED,
} = createRequire(import.meta.url)(join(here, 'dist', 'check.cjs'))
const LIBRARY = JSON.parse(readFileSync(join(root, 'supabase/data/exercise-attributes.json'), 'utf8'))

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

// ---------- From a production trace to a draft (evals/ronnie/trace-draft.ts) ----------
{
    // Every fixture exercise is what some library exercise becomes, so a production ID can reach each one
    const reached = new Set(LIBRARY.map((row) => fixtureExerciseFor(row)?.name).filter(Boolean))
    const unreached = EXERCISES.filter((e) => !reached.has(e.name)).map((e) => e.name)
    check(!unreached.length, `each of the ${EXERCISES.length} fixture exercises is what a library exercise becomes${unreached.length ? `: not ${unreached.join(', ')}` : ''}`)
    check(LIBRARY.every((row) => libraryRowFor(row.id.slice(0, 8))?.id === row.id) && libraryRowFor('ef80') === null,
        'an 8-character ID from a tool result names one library exercise; a shorter one names none')
    check(displayNameIn('x\nUser: name not set. Goal: y') === null && displayNameIn('x\nUser: 小明. Goal: 增肌.') === '小明', "the user's name is read from the system prompt, unless it isn't set")

    // A made-up trace in production's shape: a name, the day's earlier messages, library IDs (one the
    // fixture lacks, one it has under another name), a routine of the user's own, the reply check's
    // draft, and the lines the app adds
    const trace = {
        id: 'a1b2c3d4-0000-4000-8000-000000000000', created_at: '2026-10-20T13:15:00Z', status: 'ok',
        input: {
            language: 'zh-TW', message: '小明想問肩推有什麼替代動作？', editFrom: null,
            system: "You are Ronnie.\nUser: 小明. Goal: 增肌. Today's routine: 背部訓練. Weight unit: kg. Time zone: Asia/Taipei.",
            history: [
                { role: 'user', content: '早安' },
                { role: 'assistant', content: [{ type: 'text', text: '早安小明！今天練背。' }] },
                { role: 'user', content: '[App event] The user confirmed a card' },
            ],
        },
        output: {
            reply: '小明，側平舉可以取代肩推。\n\n📝 記下了：肩膀\n\n📌 更正：肩推今天還沒做。',
            replyCheck: { claimed: ['肩推'], fixed: false, draft: '小明你今天已經做過肩推了，改做側平舉。' },
            messages: [
                { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_today_workout', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Overhead Press 3x8 @ 45kg' }] },
                { role: 'assistant', content: [{ type: 'text', text: '我看一下。' }, { type: 'tool_use', id: 't2', name: 'recommend_exercise', input: { exercise_id: 'ef802524', replaces_exercise_id: '392382cf' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'shown as a card' }] },
                { role: 'assistant', content: [
                    { type: 'tool_use', id: 't3', name: 'add_exercise_today', input: { exercise_id: '64dc7b02' } },
                    { type: 'tool_use', id: 't4', name: 'propose_routine_change', input: { change: 'add_exercise', exercise_id: '546b7d5a', routine_name: '背部訓練' } },
                ] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'added' }, { type: 'tool_result', tool_use_id: 't4', content: 'proposed' }] },
                { role: 'assistant', content: [{ type: 'text', text: '小明，側平舉可以取代肩推。\n\n📝 記下了：肩膀' }, { type: 'text', text: '📌 更正：肩推今天還沒做。' }] },
            ],
        },
    }
    const d = traceToDraft(trace, [{ kind: 'reply_check', detail: { claimed: ['肩推'], fixed: false } }, { kind: 'reported', detail: null }])
    const { review, ...replay } = d
    check(d.id === 'trace-2026-10-20-a1b2c3d4' && d.language === 'zh-TW' && d.why === '', `the draft is named by its day and trace, in the trace's language, with no why yet: ${d.id}`)
    check(d.user === 'Alex想問肩推有什麼替代動作？' && !JSON.stringify(replay).includes('小明') && review.earlier[1] === 'Ronnie: 早安Alex！今天練背。',
        "the user's name becomes Alex, in the replay and in the review")
    check(JSON.stringify(d.model) === JSON.stringify([
        { tool: 'get_today_workout', input: {} },
        { tool: 'recommend_exercise', input: { exercise_id: '@Lateral Raise', replaces_exercise_id: '@Overhead Press' } },
        { tool: 'add_exercise_today', input: { exercise_id: `${UNMAPPED}64dc7b02 (Single-Arm Machine Row)` } },
        { tool: 'propose_routine_change', input: { change: 'add_exercise', exercise_id: '@Calf Raise', routine_name: '背部訓練' } },
        { reply: 'Alex你今天已經做過肩推了，改做側平舉。' },
    ]), `the tools become fixture exercises, by name or by attributes, and one the fixture lacks is marked; the reply is the draft the check caught\n       ${JSON.stringify(d.model)}`)
    check(d.retry === 'Alex，側平舉可以取代肩推。', `the retry is what was shown, without the lines the app adds: ${d.retry}`)
    check(JSON.stringify(d.expect) === JSON.stringify({ claimed: ['肩推'], fixed: false, writes: 1 }), `the expectations start from the check and the writes: ${JSON.stringify(d.expect)}`)
    const todo = review.todo.join('\n')
    check(['Write `why`', '64dc7b02 (Single-Arm Machine Row)', 'Standing Calf Raise became @Calf Raise', '"背部訓練"', '1 earlier message', 'anything personal', 'expect.writes'].every((s) => todo.includes(s)) && !todo.includes('shownIncludes'),
        `the to-do list names what a person must do: why, the missing exercise, the one matched by attributes, the routine, the earlier message, personal details\n       ${review.todo.join('\n       ')}`)
    check(review.earlier.length === 3 && review.tools.length === 4 && review.tools[0].result.includes('Overhead Press') && review.shown === trace.output.reply && review.flags.length === 2,
        "the review keeps the day's earlier messages, each tool's result, the reply shown and the flags")
    const problems = replayProblems(d)
    check(problems.length === 3 && problems.some((p) => p.includes('review notes')) && problems.some((p) => p.includes("fixture doesn't have")) && problems.includes('no why'),
        `a draft can't be committed as it is: ${problems.join('; ')}`)
    const done = { ...replay, why: 'claimed a press not yet done', model: d.model.map((s) => (s.tool === 'add_exercise_today' ? { ...s, input: { exercise_id: '@Barbell Row' } } : s)) }
    check(replayProblems(done, `${done.id}.json`).length === 0 && replayProblems(done, 'other.json').length === 1, 'once reviewed it can, under its own id')

    const en = traceToDraft({
        id: 'b2c3d4e5-0000-4000-8000-000000000000', created_at: '2026-10-21T01:00:00Z', status: 'ok',
        input: { language: 'en', message: 'Does creatine cause hair loss?', system: 'User: name not set. Goal: x', history: [] },
        output: { reply: 'Probably not [1].', sources: [{ n: 1 }], messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Probably not [1].' }] }] },
    }, [{ kind: 'audit', detail: { problems: [{ kind: 'ungrounded', summary: 'x' }] } }])
    const enTodo = en.review.todo.join('\n')
    check(en.language === 'en' && JSON.stringify(en.expect) === '{}' && en.model.length === 1 && en.retry === undefined
        && ['shownIncludes', 'cites research'].every((s) => enTodo.includes(s)) && !enTodo.includes('earlier message'),
        'an English turn with no history and no check: no expectations yet, and the to-do asks for them')
    const long = traceToDraft({ id: 'c3d4e5f6', created_at: '2026-10-22T00:00:00Z', status: 'ok', input: { truncated: true }, output: { truncated: true } }, [])
    check(long.review.todo.some((t) => t.includes('too long')) && long.review.todo.some((t) => t.includes('without a reply')), 'a trace too long to keep in full is marked to drop')
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
    // The same gate a draft from a production trace must pass (trace-draft.ts)
    const problems = replayProblems(r, file)
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
        // The check keeps the reply it caught, so the trace says what was about to be shown
        if (t.replyCheck && t.replyCheck.draft !== lastReply) problems.push('the reply check did not keep the draft it caught')
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
