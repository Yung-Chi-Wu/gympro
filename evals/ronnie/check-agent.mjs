#!/usr/bin/env node
// Offline checks of Ronnie's turn loop and data layer, with a scripted stand-in for Claude and for
// Supabase: no API calls, no database. What happens when a tool throws, a model call fails or the
// user presses Stop after something already changed; refusals said next to proposals; routine names
// that match more than one; set reads past 1000 rows; a workout half created; memory notes (one per
// slot, the line under the reply written by code, disliked exercises kept out of recommendations).
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
    buildSystemPrompt, fixtureNotes, memoryLines, MAX_NOTES, MAX_EXERCISE_NOTES_SHOWN, MAX_OTHER_NOTES,
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

// ---------- memory ----------

function note(kind, subject, state, text, updatedAt = '2026-10-01T02:00:00.000Z') {
    return { kind, subject, state, text, updatedAt }
}

// One note per slot: saved, unchanged when said again, replaced when it changes, forgotten on request
{
    const { data, memories } = createFixtureData()
    const ex = executorFor(data)
    const saved = await ex.executeTool('remember', { kind: 'injury', joint: 'knee', text: '左膝舊傷，深蹲蹲深會痛' })
    check(saved.startsWith('Saved') && memories.length === 1 && memories[0].subject === 'knee' && memories[0].state === 'active', `an injury is saved, active by default: ${saved.slice(0, 60)}`)
    check(ex.remembered[0] === '📝 我記住了：左膝舊傷，深蹲蹲深會痛', `the line under the reply is written by code: ${ex.remembered[0]}`)
    const again = await ex.executeTool('remember', { kind: 'injury', joint: 'knee', state: 'active', text: '左膝舊傷，深蹲蹲深會痛' })
    check(/nothing changed/.test(again) && ex.remembered.length === 1, `the same note again changes nothing and adds no line: ${again}`)
    const healed = await ex.executeTool('remember', { kind: 'injury', joint: 'knee', state: 'resolved', text: '左膝已經好了' })
    check(healed.startsWith('Updated') && memories.length === 1 && memories[0].state === 'resolved', `"better" replaces the note in its slot: ${healed.slice(0, 70)}`)
    check(ex.remembered[1] === '📝 已更新：左膝已經好了', `an update says so: ${ex.remembered[1]}`)
    await ex.executeTool('remember', { kind: 'equipment', text: '在家，只有可調式啞鈴' })
    const more = await ex.executeTool('remember', { kind: 'equipment', state: 'like', text: '在家，可調式啞鈴和彈力帶' })
    check(more.startsWith('Updated') && memories.filter((n) => n.kind === 'equipment').length === 1 && memories.find((n) => n.kind === 'equipment').state === 'active', `equipment is one note, always active: ${more.slice(0, 60)}`)
    const forgot = await ex.executeTool('forget', { kind: 'injury', joint: 'knee' })
    check(forgot.startsWith('Deleted') && !memories.some((n) => n.kind === 'injury') && ex.remembered.at(-1) === '📝 已忘記：左膝已經好了', `forget deletes the note and says so: ${ex.remembered.at(-1)}`)
    const none = await ex.executeTool('forget', { kind: 'injury', joint: 'knee' })
    const lines = ex.remembered.length
    check(/no note/.test(none) && ex.remembered.length === lines, `forgetting what isn't there changes nothing: ${none}`)
}

// What can't be a note isn't saved: an unknown body part, kind or state, an exercise not in the library
{
    const { data, memories } = createFixtureData()
    const ex = executorFor(data)
    const results = [
        await ex.executeTool('remember', { kind: 'injury', joint: 'toe', text: 'x' }),
        await ex.executeTool('remember', { kind: 'goal', text: '臥推 100 公斤' }),
        await ex.executeTool('remember', { kind: 'injury', joint: 'knee', state: 'dislike', text: 'x' }),
        await ex.executeTool('remember', { kind: 'exercise', exercise_name: '波比跳', text: '討厭波比跳' }),
        await ex.executeTool('remember', { kind: 'exercise', exercise_name: '超級深蹲', state: 'dislike', text: 'x' }),
        await ex.executeTool('remember', { kind: 'exercise', exercise_id: 'deadbeef', state: 'dislike', text: 'x' }),
        await ex.executeTool('remember', { kind: 'schedule', text: '   ' }),
    ]
    check(results.every((r) => r.startsWith('Not saved')) && !memories.length && !ex.remembered.length, `none of them is saved: ${results.map((r) => r.slice(0, 40)).join(' | ')}`)
    check(/search_exercises/.test(results[4]), `a name not in the library points to search_exercises: ${results[4]}`)
    const byName = await ex.executeTool('remember', { kind: 'exercise', exercise_name: '波比跳', state: 'dislike', text: '討厭波比跳' })
    const byId = await ex.executeTool('remember', { kind: 'exercise', exercise_id: id('Back Squat').slice(0, 8), state: 'like', text: '喜歡深蹲' })
    check(byName.startsWith('Saved') && byId.startsWith('Saved') && memories.map((n) => n.subject).join() === [id('Burpee'), id('Back Squat')].join(), `an exercise by its name or its short ID is saved under its full ID (${memories.map((n) => n.subject.slice(0, 8)).join(', ')})`)
    const long = await ex.executeTool('remember', { kind: 'schedule', text: '平日'.repeat(150) })
    check(long.startsWith('Saved') && memories.at(-1).text.length === 200, `a long text is cut to 200 characters (${memories.at(-1).text.length})`)
}

// A disliked exercise is left out of search and cards, unless the user names it; adding it goes ahead
{
    const { data, memories } = createFixtureData({ memories: [note('exercise', id('Burpee'), 'dislike', '討厭波比跳')] })
    const ex = executorFor(data)
    const core = await ex.executeTool('search_exercises', { muscle: 'core' })
    check(!/ID: [^\n]*波比跳/.test(core) && /Left out[^\n]*波比跳/.test(core), `a core search leaves out Burpee and says why: ${core.split('\n').at(-1)}`)
    const named = await ex.executeTool('search_exercises', { query: '波比跳' })
    check(/ID: [^\n]*波比跳/.test(named), `a search for it by name still finds it: ${named.split('\n')[0]}`)
    const card = await ex.executeTool('recommend_exercise', { exercise_id: id('Burpee') })
    check(/No card shown/.test(card) && !ex.recommendations.length, `no card for it: ${card.slice(0, 60)}`)
    const added = await ex.executeTool('add_exercise_today', { exercise_id: id('Burpee') })
    check(added.startsWith('✓') && /ask once/.test(added) && memories[0].state === 'dislike', `the user's own add goes ahead, the note stays, and Ronnie is told to ask: ${added.slice(0, 50)}`)
    check(ex.confirmations.at(-1) === '✓ 已將「波比跳」加入今天的課表', `the user sees only the add: ${ex.confirmations.at(-1)}`)
}

// Other notes: each has its own ID, a change names the note it replaces, the same text twice is one note
{
    const { data, memories } = createFixtureData()
    const ex = executorFor(data)
    const first = await ex.executeTool('remember', { kind: 'other', text: '有氣喘，強度一高容易喘' })
    const asthma = memories[0]
    check(first.startsWith('Saved') && asthma?.kind === 'other' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(asthma.subject) && ex.remembered[0] === '📝 我記住了：有氣喘，強度一高容易喘', `an other note gets an ID of its own: ${first.slice(0, 40)}`)
    const twice = await ex.executeTool('remember', { kind: 'other', text: '有氣喘，強度一高容易喘' })
    check(/nothing changed/.test(twice) && memories.length === 1, `the same fact again is not a second note: ${twice}`)
    const second = await ex.executeTool('remember', { kind: 'other', text: '12 月要比賽' })
    check(second.startsWith('Saved') && memories.length === 2 && memories[1].subject !== asthma.subject, 'a different fact is a note of its own')
    const changed = await ex.executeTool('remember', { kind: 'other', note_id: asthma.subject.slice(0, 8), text: '有氣喘，練前要先用藥' })
    check(changed.startsWith('Updated') && memories.length === 2 && memories[0].subject === asthma.subject && memories[0].text === '有氣喘，練前要先用藥', `a change by note_id replaces that note: ${changed.slice(0, 60)}`)
    const unknown = await ex.executeTool('remember', { kind: 'other', note_id: 'ffffffff', text: 'x' })
    const unnamed = await ex.executeTool('forget', { kind: 'other' })
    check(unknown.startsWith('Not saved') && unnamed.startsWith('Nothing forgotten') && memories.length === 2, `an unknown note_id saves nothing, and forget needs one: ${unknown.slice(0, 50)} | ${unnamed.slice(0, 50)}`)
    const gone = await ex.executeTool('forget', { kind: 'other', note_id: asthma.subject.slice(0, 8) })
    check(gone.startsWith('Deleted') && memories.length === 1 && ex.remembered.at(-1) === '📝 已忘記：有氣喘，練前要先用藥', `forget by note_id: ${ex.remembered.at(-1)}`)
}

// At the other notes' limit a new one is refused, with the notes to fold it into; folding it in is an update
{
    const seeded = Array.from({ length: MAX_OTHER_NOTES }, (_, i) => note('other', `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, 'active', `fact ${i}`))
    const { data, memories } = createFixtureData({ memories: seeded })
    const ex = executorFor(data)
    const full = await ex.executeTool('remember', { kind: 'other', text: '吃全素' })
    check(full.startsWith('Not saved') && /note ID: 00000003 \| fact 3/.test(full) && memories.length === MAX_OTHER_NOTES && !ex.remembered.length, `the ${MAX_OTHER_NOTES + 1}th is refused with the list, and nothing is shown to the user: ${full.slice(0, 50)}`)
    const folded = await ex.executeTool('remember', { kind: 'other', note_id: '00000003', text: 'fact 3；吃全素' })
    check(folded.startsWith('Updated') && memories.length === MAX_OTHER_NOTES && ex.remembered[0] === '📝 已更新：fact 3；吃全素', `folded into a note, it is saved as an update: ${ex.remembered[0]}`)
    const wrist = await ex.executeTool('remember', { kind: 'injury', joint: 'wrist', text: '左手腕骨折過' })
    check(wrist.startsWith('Saved') && memories.length === MAX_OTHER_NOTES + 1, 'the slots are not counted against the other notes')
    check(fixtureNotes([note('other', '12345678-0000-4000-8000-000000000000', 'active', '有氣喘')], 'zh-TW')[0] === '- other (note ID: 12345678), saved 2026-10-01: 有氣喘', 'the prompt lists an other note with its ID')
}

// Notes whose IDs begin alike are shown and named in full (memory eval v2: all 30 read "00000000")
{
    const shared = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const seeded = [note('other', shared(1), 'active', '乳糖不耐'), note('other', shared(2), 'active', '有氣喘'), note('other', 'abcdef12-0000-4000-8000-000000000000', 'active', '慣用左手')]
    const lines = fixtureNotes(seeded, 'zh-TW')
    check(lines.some((l) => l.includes(`(note ID: ${shared(1)})`)) && lines.some((l) => l.includes('(note ID: abcdef12)')), `shared beginnings are shown in full, others as 8: ${lines.map((l) => l.match(/note ID: ([^)]+)/)?.[1]).join(', ')}`)
    const { data, memories } = createFixtureData({ memories: seeded })
    const ex = executorFor(data)
    const ambiguous = await ex.executeTool('remember', { kind: 'other', note_id: '00000000', text: '乳糖不耐；吃全素' })
    check(/Several other notes start with 00000000/.test(ambiguous) && memories[0].text === '乳糖不耐', `a short ID two notes share is refused as ambiguous: ${ambiguous}`)
    const whole = await ex.executeTool('remember', { kind: 'other', note_id: shared(1), text: '乳糖不耐；吃全素' })
    check(whole.startsWith('Updated') && memories[0].text === '乳糖不耐；吃全素' && memories.length === 3, `the whole ID names the note: ${whole.slice(0, 60)}`)
    const full = Array.from({ length: MAX_OTHER_NOTES }, (_, i) => note('other', shared(i), 'active', `fact ${i}`))
    const { data: fullData } = createFixtureData({ memories: full })
    const refused = await executorFor(fullData).executeTool('remember', { kind: 'other', text: '吃全素' })
    check(refused.includes(`note ID: ${shared(3)} | fact 3`), 'the full list gives whole IDs when they share a beginning')
}

// An injured joint is marked in search results
{
    const { data } = createFixtureData({ memories: [note('injury', 'knee', 'active', '左膝舊傷')] })
    const legs = await executorFor(data).executeTool('search_exercises', { muscle: 'legs' })
    const squat = legs.split('\n').find((l) => l.includes('深蹲')) ?? ''
    check(/knee medium \(injured, in your notes\)/.test(squat), `squat's knee load is marked: ${squat}`)
    const { data: healed } = createFixtureData({ memories: [note('injury', 'knee', 'resolved', '左膝好了')] })
    check(!/injured/.test(await executorFor(healed).executeTool('search_exercises', { muscle: 'legs' })), 'a resolved injury marks nothing')
}

// The note's line comes first in the reply, also when the model says nothing, and survives a failure
{
    const { data } = createFixtureData()
    const t = await turn(scripted([toolUse(['remember', { kind: 'injury', joint: 'knee', text: '左膝舊傷' }]), reply('先把深度控制在不痛的範圍。')]), data)
    check(t.message === '📝 我記住了：左膝舊傷\n\n先把深度控制在不痛的範圍。', `the line, then the reply: ${t.message.replace(/\n/g, ' / ')}`)
    const { data: d2 } = createFixtureData()
    const quiet = await turn(scripted([toolUse(['remember', { kind: 'injury', joint: 'knee', text: '左膝舊傷' }]), reply(''), reply('')]), d2)
    check(quiet.message === '📝 我記住了：左膝舊傷', `with no reply, just the line, not "sorry": ${quiet.message}`)
    const { data: d3 } = createFixtureData()
    const failed = await turn(scripted([toolUse(['remember', { kind: 'injury', joint: 'knee', text: '左膝舊傷' }]), () => { throw new Error('Overloaded') }]), d3)
    check(failed.interrupted?.reason === 'error' && failed.message.startsWith('📝 我記住了：左膝舊傷'), `a failed turn still says what was saved: ${failed.message.replace(/\n/g, ' / ')}`)
    const { data: d4 } = createFixtureData()
    const proposed = await turn(scripted([toolUse(['remember', { kind: 'exercise', exercise_name: '波比跳', state: 'dislike', text: '討厭波比跳' }], ['propose_routine_change', { change: 'remove', exercise_id: id('Burpee') }]), reply('好的，已經記下來了！')]), d4)
    check(proposed.message.startsWith('📝 我記住了：討厭波比跳\n\n已準備好') && !proposed.message.includes('記下來了'), `beside a proposal, the line and the proposal in the code's words: ${proposed.message.replace(/\n/g, ' / ')}`)
}

// Only against abuse: at the cap, the oldest note that isn't an active injury makes room
{
    const seeded = [
        note('injury', 'knee', 'active', '左膝舊傷', '2026-01-01T00:00:00.000Z'),
        ...Array.from({ length: MAX_NOTES - 1 }, (_, i) => note('exercise', `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, 'like', `like ${i}`, `2026-02-${String(1 + (i % 28)).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}.000Z`)),
    ]
    const { data, memories } = createFixtureData({ memories: seeded })
    const oldest = seeded.slice(1).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]
    const r = await executorFor(data).executeTool('remember', { kind: 'schedule', text: '平日 45 分鐘' })
    check(r.startsWith('Saved') && memories.length === MAX_NOTES && memories.some((n) => n.kind === 'injury') && !memories.some((n) => n.text === oldest.text), `${MAX_NOTES} notes at most; the active injury stays, the oldest other goes (${memories.length})`)
}

// The prompt lists the notes, dated in the user's zone; exercise preferences the latest first, capped
{
    const notes = [
        note('exercise', id('Burpee'), 'dislike', '討厭波比跳', '2026-10-06T20:00:00.000Z'),
        note('injury', 'lower_back', 'active', '下背舊傷'),
        note('equipment', null, 'active', '只有啞鈴'),
    ]
    const lines = fixtureNotes(notes, 'zh-TW')
    check(lines[0] === '- injury (lower back), active, saved 2026-10-01: 下背舊傷' && lines[1] === '- equipment, saved 2026-10-01: 只有啞鈴', `injuries and equipment first: ${lines.slice(0, 2).join(' / ')}`)
    check(lines[2] === `- exercise "波比跳" (ID: ${id('Burpee').slice(0, 8)}), dislike, saved 2026-10-07: 討厭波比跳`, `an exercise by name and ID, dated in Taipei (UTC 20:00 is the next day): ${lines[2]}`)
    const system = buildSystemPrompt('zh-TW', { ...FIXTURE_USER, notes: lines })
    check(system.includes(lines.join('\n')) && buildSystemPrompt('zh-TW', FIXTURE_USER).includes('- none yet'), 'the system prompt lists them, or says there are none')
    const many = Array.from({ length: MAX_EXERCISE_NOTES_SHOWN + 5 }, (_, i) => note('exercise', EXERCISES[i % EXERCISES.length].id + (i >= EXERCISES.length ? `-${i}` : ''), 'like', `like ${i}`, `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`))
    const shown = memoryLines(many, () => 'X', 'Asia/Taipei')
    check(shown.length === MAX_EXERCISE_NOTES_SHOWN + 1 && /and 5 older exercise preferences/.test(shown.at(-1)) && !shown.some((l) => l.endsWith(': like 0')), `at most ${MAX_EXERCISE_NOTES_SHOWN} preferences, the oldest left out and counted: ${shown.at(-1)}`)
    check(memoryLines([note('exercise', 'gone', 'dislike', 'x')], () => null, 'Asia/Taipei').length === 0, 'a note on an exercise the user can no longer see is left out')
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

// Memory notes go through the service-role client, always for this user; without it there is no memory
{
    const fake = fakeSupabase((q) => (q.ops.some(([k]) => k === 'select') && q.table === 'ronnie_memories'
        ? { data: [{ kind: 'injury', subject: 'knee', state: 'active', note: '左膝舊傷', updated_at: '2026-10-01T00:00:00Z' }, { kind: 'mood', subject: null, state: 'active', note: 'x', updated_at: '2026-10-02T00:00:00Z' }], error: null }
        : { data: null, error: null }))
    const userClient = fakeSupabase(() => ({ data: null, error: null }))
    const data = createSupabaseRonnieData(userClient, 'u1', FIXTURE_TIME_ZONE, null, { memory: fake })
    const [a, b] = await Promise.all([data.listMemories(), data.listMemories()])
    const reads = () => fake.requests.filter((q) => q.ops.some(([k]) => k === 'select'))
    check(a.length === 1 && a[0].text === '左膝舊傷' && b === a && reads().length === 1, `read once per request, unknown kinds dropped (${a.length} note, ${reads().length} read)`)
    check(op(reads()[0], 'eq')?.join() === 'user_id,u1' && !userClient.requests.length, 'the read names the user and never uses their own client')
    await data.saveMemory({ kind: 'equipment', subject: null, state: 'active', text: '只有啞鈴', updatedAt: '2026-10-07T02:00:00.000Z' })
    const upsert = fake.requests.find((q) => op(q, 'upsert'))
    check(op(upsert, 'upsert')[0].user_id === 'u1' && op(upsert, 'upsert')[0].note === '只有啞鈴' && op(upsert, 'upsert')[1]?.onConflict === 'user_id,kind,subject', 'a save upserts on the slot, for this user')
    await data.listMemories()
    check(reads().length === 2, 'after a save the notes are read again')
    await data.deleteMemory({ kind: 'equipment', subject: null })
    const del = fake.requests.find((q) => op(q, 'delete'))
    check(op(del, 'is')?.join() === 'subject,' && del.ops.filter(([k]) => k === 'eq').map(([, v]) => v.join()).join(';') === 'user_id,u1;kind,equipment', 'a delete names the user and the slot, a missing subject as is null')

    const none = createSupabaseRonnieData(userClient, 'u1', FIXTURE_TIME_ZONE, null)
    check((await none.listMemories()).length === 0 && (await none.saveMemory(note('schedule', null, 'active', 'x'))) === 'Memory is not available', 'without the service-role client: no notes, and saving says so')
    const broken = createSupabaseRonnieData(userClient, 'u1', FIXTURE_TIME_ZONE, null, { memory: fakeSupabase(() => ({ data: null, error: { message: 'timeout' } })) })
    let message = null
    try { await broken.listMemories() } catch (err) { message = err.message }
    check(/Could not read the memory notes: timeout/.test(message ?? ''), `a failed read throws, instead of reading as no notes (${message})`)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll agent and data checks pass')
process.exit(failures ? 1 : 0)
