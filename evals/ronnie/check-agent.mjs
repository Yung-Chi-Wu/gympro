#!/usr/bin/env node
// Offline checks of Ronnie's turn loop and data layer, with a scripted stand-in for Claude and for
// Supabase: no API calls, no database. What happens when a tool throws, a model call fails or the
// user presses Stop after something already changed; refusals said next to proposals; routine names
// that match more than one; set reads past 1000 rows; a workout half created.
//   node evals/ronnie/check-agent.mjs

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
execFileSync(join(root, 'lambda/ai-worker/node_modules/.bin/esbuild'), ['evals/ronnie/check-entry.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=evals/ronnie/dist/check.cjs', '--log-level=warning'], { cwd: root, stdio: 'inherit' })
const {
    runRonnieTurn, stripMarkdown, createRonnieExecutor, MAX_REMOVALS_PER_TURN, createSupabaseRonnieData,
    createFixtureData, EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER,
} = createRequire(import.meta.url)(join(here, 'dist', 'check.cjs'))

let failures = 0
const check = (cond, msg) => { if (!cond) { failures++; console.log(`FAIL ${msg}`) } else console.log(`ok   ${msg}`) }
const id = (name) => EXERCISES.find((e) => e.name === name).id
const executorFor = (data, language = 'zh-TW') => createRonnieExecutor({
    data, language, timeZone: FIXTURE_TIME_ZONE, todayRoutineName: FIXTURE_USER.todayRoutineName, now: () => FIXTURE_NOW,
})

// A stand-in for the Claude client: each call takes the next step of the script, which returns a
// response or throws
const usage = { input_tokens: 10, output_tokens: 5 }
const toolUse = (...calls) => ({ stop_reason: 'tool_use', model: 'fake', usage, content: calls.map(([name, input], i) => ({ type: 'tool_use', id: `t${i}-${name}`, name, input })) })
const reply = (text) => ({ stop_reason: 'end_turn', model: 'fake', usage, content: [{ type: 'text', text }] })
function scripted(steps) {
    let i = 0
    const calls = []
    return { calls, messages: { create: async (params, options) => {
        calls.push({ params, options })
        const step = steps[i++]
        if (!step) throw new Error('script ran out')
        return typeof step === 'function' ? step(params, options) : step
    } } }
}
const turn = (client, data, extra = {}) => runRonnieTurn({ client, system: 'test', messages: [{ role: 'user', content: 'hi' }], executor: extra.executor ?? executorFor(data), language: 'zh-TW', ...extra })
/** The history the next request would send: every tool_use answered, ending in a reply */
const valid = (messages) => messages.every((m, i) => {
    if (m.role !== 'assistant' || typeof m.content === 'string') return true
    const uses = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id)
    const next = messages[i + 1]
    return uses.every((u) => next?.role === 'user' && next.content.some((b) => b.type === 'tool_result' && b.tool_use_id === u))
}) && messages.at(-1).role === 'assistant'

// ---------- the turn loop ----------

// A tool that throws answers as a failed result and the turn goes on; the add beside it stays reported
{
    const { data } = createFixtureData()
    const failing = { ...data, getWorkoutsBetween: async () => { throw new RangeError('Invalid time value') } }
    const client = scripted([
        toolUse(['add_exercise_today', { exercise_id: id('Lateral Raise') }], ['get_workout_history', { date_from: '2026-10-5', date_to: '2026-10-06' }]),
        (params) => {
            const results = params.messages.at(-1).content
            const failed = results.find((b) => b.tool_use_id.endsWith('get_workout_history'))
            check(failed?.is_error === true && /failed: Invalid time value/.test(failed.content), `a thrown tool error reaches the model as a failed result: ${failed?.content.slice(0, 60)}`)
            return reply('已加入側平舉，歷史查詢失敗了。')
        },
    ])
    const t = await turn(client, failing)
    check(!t.interrupted && t.message.includes('側平舉'), `the turn finishes with the model's reply: ${t.message}`)
    check(t.toolCalls.length === 2 && t.reloadDashboard, 'both calls are recorded and the dashboard reloads for the add')
}

// The next model call fails after a change: the turn returns what was done instead of an error
{
    const { data } = createFixtureData()
    const client = scripted([
        toolUse(['remove_exercise_today', { exercise_id: id('Overhead Press'), exercise_name: '肩推' }]),
        () => { throw Object.assign(new Error('Overloaded'), { status: 529 }) },
    ])
    let t = null
    try { t = await turn(client, data) } catch (err) { check(false, `a failure after a change is not thrown (${err.message})`) }
    if (t) {
        check(t.interrupted?.reason === 'error' && /Overloaded/.test(t.interrupted.error), `the turn is marked interrupted by the error (${t.interrupted?.reason})`)
        check(t.message.includes('✓') && t.message.includes('肩推') && t.message.includes('回覆沒有完成'), `the reply states the removal and that the reply didn't finish: ${t.message.replace(/\n/g, ' / ')}`)
        check(t.reloadDashboard, 'the dashboard reloads for the removal')
        check(valid(t.messages), 'the saved history stays valid for the next request')
    }
}

// The same failure with nothing changed yet is still an error, so the user simply asks again
{
    const { data } = createFixtureData()
    const client = scripted([() => { throw new Error('Overloaded') }])
    let threw = false
    try { await turn(client, data) } catch { threw = true }
    check(threw, 'a failure before anything changed is still thrown')
}

// Stop: the signal reaches the model call, and after a change the turn ends with what was done
{
    const { data } = createFixtureData()
    const controller = new AbortController()
    const client = scripted([
        toolUse(['add_exercise_today', { exercise_id: id('Lateral Raise') }]),
        (params, options) => {
            check(options?.signal === controller.signal, 'the Stop signal is passed to the model call')
            controller.abort()
            throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })
        },
    ])
    const t = await turn(client, data, { signal: controller.signal })
    check(t.interrupted?.reason === 'aborted' && t.message.includes('已停止') && t.message.includes('側平舉'), `a stopped turn keeps what was done: ${t.message.replace(/\n/g, ' / ')}`)
    check(valid(t.messages), 'the stopped turn leaves a valid history')
}

// Stopped before the next round starts: no more model calls
{
    const { data } = createFixtureData()
    const controller = new AbortController()
    const client = scripted([
        () => { controller.abort(); return toolUse(['add_exercise_today', { exercise_id: id('Lateral Raise') }]) },
        reply('should not be called'),
    ])
    const t = await turn(client, data, { signal: controller.signal })
    check(client.calls.length === 1 && t.interrupted?.reason === 'aborted', `no model call after Stop (${client.calls.length} calls)`)
}

// More removals than allowed: the reply names the ones proposed and the one that wasn't
{
    const { data } = createFixtureData()
    const names = ['Barbell Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Triceps Pushdown']
    const client = scripted([
        toolUse(...names.map((n) => ['propose_routine_change', { change: 'remove', exercise_id: id(n) }])),
        reply('已處理！'),
    ])
    const executor = executorFor(data)
    const t = await turn(client, data, { executor })
    const ready = t.message.split('\n').filter((l) => l.startsWith('已準備好'))
    check(executor.proposals.length === MAX_REMOVALS_PER_TURN && ready.length === MAX_REMOVALS_PER_TURN, `${MAX_REMOVALS_PER_TURN} removals are proposed (${ready.length} lines)`)
    check(t.message.includes(`一次最多移除 ${MAX_REMOVALS_PER_TURN} 個動作`), `the 4th is said not to be proposed: ${t.message.split('\n').at(-1)}`)
    check(!t.message.includes('已處理'), "the model's own wording is not the reply")
}

// ---------- the tools ----------

// A routine name that matches more than one asks which; the exact name picks that one
{
    const { data } = createFixtureData()
    const executor = executorFor(data)
    const ambiguous = await executor.executeTool('get_routine_exercises', { routine_name: '日' })
    check(/Several routines match "日": .*推日.*拉日.*腿日|Several routines match "日"/.test(ambiguous) && !ambiguous.includes('ID:'), `a name that matches three routines asks which: ${ambiguous.slice(0, 70)}`)
    const exact = await executor.executeTool('get_routine_exercises', { routine_name: '腿日' })
    check(exact.startsWith('"腿日"'), `the exact name lists that routine: ${exact.split('\n')[0]}`)
    const add = await executor.executeTool('propose_routine_change', { change: 'add', exercise_id: id('Lateral Raise'), routine_name: '日' })
    check(/Several routines match/.test(add) && executor.proposals.length === 0 && executor.notices.some((n) => n.includes('要加到哪一個')), `an ambiguous routine is not guessed for an add: ${executor.notices.at(-1)}`)
}

// Adding what today's workout already has says so, instead of a raw constraint error
{
    const { data, writes } = createFixtureData()
    const executor = executorFor(data)
    const today = await executor.executeTool('get_today_workout', {})
    const planned = EXERCISES.find((e) => today.includes(e.name_zh_tw ?? e.name))
    const before = writes.length
    const result = await executor.executeTool('add_exercise_today', { exercise_id: planned.id })
    check(/already in today's workout; nothing added/.test(result) && writes.length === before, `adding a planned exercise again is refused without a write: ${result}`)
}

// A muscle written with a space or capitals still filters
{
    const { data } = createFixtureData()
    const executor = executorFor(data)
    const spaced = await executor.executeTool('search_exercises', { muscle: 'Upper Chest' })
    const plain = await executor.executeTool('search_exercises', { muscle: 'upper_chest' })
    check(!/^No exercises found/.test(spaced) && spaced === plain, `"Upper Chest" filters like upper_chest: ${spaced.split('\n')[0]}`)
}

// An exercise taken off today's plan after its sets were logged still shows with them
{
    const { data } = createFixtureData()
    const executor = executorFor(data)
    const before = await executor.executeTool('get_today_workout', {})
    const logged = EXERCISES.find((e) => before.split('\n').some((l) => l.includes(e.name_zh_tw ?? e.name) && /×/.test(l)))
    await executor.executeTool('remove_exercise_today', { exercise_id: logged.id })
    const after = await executor.executeTool('get_today_workout', {})
    const line = after.split('\n').find((l) => l.includes(logged.name_zh_tw ?? logged.name)) ?? '(missing)'
    check(line.includes('taken off today') && /×/.test(line), `its sets stay visible: ${line}`)
}

// A range that ends before today is a partial week, not "this week so far, today's sets included"
{
    const { data } = createFixtureData()
    const summary = await executorFor(data).executeTool('get_training_summary', { date_from: '2026-10-05', date_to: '2026-10-06' })
    const first = summary.split('\n')[0]
    check(!/so far/.test(summary) && /This week, partial/.test(first), `Monday to Tuesday on a Wednesday: ${first}`)
    const soFar = await executorFor(data).executeTool('get_training_summary', { date_from: '2026-10-05', date_to: '2026-10-07' })
    check(/This week so far/.test(soFar.split('\n')[0]), `up to today it is "so far": ${soFar.split('\n')[0]}`)
}

// The best set is the highest estimated 1RM, as the app shows it: 8 x 90 kg beats 1 x 100 kg
{
    const { data } = createFixtureData()
    const todayId = await data.ensureTodayWorkout()
    const bench = id('Barbell Bench Press')
    const blank = { durationS: null, speedKmh: null, inclinePct: null, level: null, distanceM: null, assistKg: null, inputUnit: 'kg' }
    const extra = [{ workout_id: todayId, exercise_id: bench, reps: 1, weightKg: 100, ...blank }, { workout_id: todayId, exercise_id: bench, reps: 8, weightKg: 90, ...blank }]
    const withSets = { ...data, getSets: async (ids) => [...(await data.getSets(ids)), ...extra.filter((s) => ids.includes(s.workout_id))] }
    const summary = await executorFor(withSets).executeTool('get_training_summary', { date_from: '2026-10-07', date_to: '2026-10-07' })
    const line = summary.split('\n').find((l) => l.includes('By exercise')) ?? ''
    check(/槓鈴臥推[^;]*best 8×90kg/.test(line), `bench's best is 8×90kg: ${line.slice(0, 120)}`)
}

// The reply's Markdown is stripped, but sets x reps are not emphasis
{
    check(stripMarkdown('做 3*10，再 4*8') === '做 3*10，再 4*8', `"3*10" stays: ${stripMarkdown('做 3*10，再 4*8')}`)
    check(stripMarkdown('這是 *重點* 和 **粗體**') === '這是 重點 和 粗體', `emphasis is still removed: ${stripMarkdown('這是 *重點* 和 **粗體**')}`)
}

// ---------- the Supabase data layer, against a stand-in client ----------

/** A query builder that records each call and answers when awaited, by table and operations */
function fakeSupabase(answer) {
    const requests = []
    return {
        requests,
        from(table) {
            const q = { table, ops: [] }
            requests.push(q)
            const builder = new Proxy({}, {
                get(_, key) {
                    if (key === 'then') return (resolve, reject) => Promise.resolve().then(() => answer(q)).then(resolve, reject)
                    return (...args) => { q.ops.push([key, args]); return builder }
                },
            })
            return builder
        },
    }
}
const op = (q, name) => q.ops.find(([k]) => k === name)?.[1]

// Sets past 1000 rows are read in pages, a limited number of workouts per request
{
    const workoutIds = Array.from({ length: 150 }, (_, i) => `w${String(i).padStart(3, '0')}`)
    const rows = workoutIds.flatMap((w) => Array.from({ length: 17 }, (_, n) => ({ id: `${w}-${n}`, workout_id: w, exercise_id: 'e1', set_number: n + 1, reps: 8, weight_kg: 50 })))
    const fake = fakeSupabase((q) => {
        const ids = op(q, 'in')[1]
        const [from, to] = op(q, 'range')
        return { data: rows.filter((r) => ids.includes(r.workout_id)).slice(from, to + 1), error: null }
    })
    const data = createSupabaseRonnieData(fake, 'u1', FIXTURE_TIME_ZONE, null)
    const sets = await data.getSets(workoutIds)
    const widest = Math.max(...fake.requests.map((q) => op(q, 'in')[1].length))
    check(sets.length === rows.length, `all ${rows.length} sets come back (got ${sets.length})`)
    check(widest <= 100 && fake.requests.every((q) => op(q, 'order')), `at most 100 workouts per request, each ordered (widest ${widest})`)

    const broken = createSupabaseRonnieData(fakeSupabase(() => ({ data: null, error: { message: 'timeout' } })), 'u1', FIXTURE_TIME_ZONE, null)
    let message = null
    try { await broken.getSets(['w1']) } catch (err) { message = err.message }
    check(/Could not read the sets: timeout/.test(message ?? ''), `a failed read throws instead of reading as no sets (${message})`)
}

// Today's workout is created with the routine's exercises once each, or not at all
{
    const cycle = { id: 'c1', cycle_length: 3, start_date: '2026-10-01' }
    const run = async (planError) => {
        let plannedRows = null
        const fake = fakeSupabase((q) => {
            const has = (name) => q.ops.some(([k]) => k === name)
            if (q.table === 'workouts' && has('insert')) return { data: { id: 'w-new' }, error: null }
            if (q.table === 'workouts' && has('delete')) return { data: null, error: null }
            if (q.table === 'workouts') return { data: null, error: null }
            if (q.table === 'cycle_days') return { data: { routine_id: 'r1' }, error: null }
            if (q.table === 'routine_exercises') return { data: [{ exercise_id: 'squat' }, { exercise_id: 'squat' }, { exercise_id: 'rdl' }], error: null }
            if (q.table === 'workout_planned_exercises') { plannedRows = op(q, 'insert')[0]; return { data: null, error: planError } }
            return { data: null, error: null }
        })
        const data = createSupabaseRonnieData(fake, 'u1', FIXTURE_TIME_ZONE, cycle, { now: () => FIXTURE_NOW })
        const id = await data.ensureTodayWorkout()
        const deleted = fake.requests.some((q) => q.table === 'workouts' && q.ops.some(([k]) => k === 'delete'))
        return { id, plannedRows, deleted }
    }
    const ok = await run(null)
    check(ok.id === 'w-new' && ok.plannedRows.length === 2 && !ok.deleted, `a routine listing squat twice plans it once (${ok.plannedRows?.map((r) => r.exercise_id).join(', ')})`)
    const failed = await run({ message: 'duplicate key value violates unique constraint' })
    check(failed.id === null && failed.deleted, 'a failed plan insert removes the empty workout and reports no workout')
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll agent and data checks pass')
process.exit(failures ? 1 : 0)
