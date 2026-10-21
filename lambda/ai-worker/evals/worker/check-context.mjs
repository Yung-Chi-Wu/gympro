#!/usr/bin/env node
// Free check of what the report reads besides the log and the goal (report/week.ts, fetchMemory and
// fetchMessages in fetch.ts, facts.context): no model, no database. What the user said this period
// is kept only where its words are found in the text it names, with that text's date and source;
// only the user's own lines to Ronnie are read; Ronnie's notes keep their local date; a read that
// fails leaves the report without it; and none of it reaches the advice yet.
//   node lambda/ai-worker/evals/worker/check-context.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/worker/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/worker/dist/worker.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const w = createRequire(import.meta.url)(join(here, 'dist', 'worker.cjs'))

let failed = 0
const check = (name, ok, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

const ex = (id, name, nameZh, primary) => ({ id, name, nameZh, muscleGroup: 'x', primaryMuscles: primary, secondaryMuscles: [], logType: 'weight_reps' })
const BENCH = ex('ex-bench', 'Barbell Bench Press', '槓鈴臥推', ['chest'])
const SQUAT = ex('ex-squat', 'Barbell Back Squat', '槓鈴深蹲', ['quads', 'glutes'])

// ---------- The reader's answer, checked ----------

const TEXTS = [
    { date: '2026-10-13', source: 'note', text: '睡不好，有點累' },
    { date: '2026-10-15', source: 'ronnie', text: '今天臥推的時候右手肘有點痛，要換動作嗎？' },
    { date: '2026-10-16', source: 'ronnie', text: 'Legs are SO sore from Monday' },
]
{
    const { byKey } = w.weekKeys(TEXTS)
    const { byKey: exercises } = w.exerciseKeys([BENCH, SQUAT], [])
    const benchKey = [...exercises].find(([, e]) => e.id === 'ex-bench')[0]
    const signals = w.checkedSignals({
        signals: [
            { from: 't2', kind: 'pain', joint: 'elbow', exercise: benchKey, text: '右手肘有點痛' },
            { from: 't1', kind: 'tired', joint: 'knee', text: '睡不好，有點累' },
            { from: 't3', kind: 'sore', joint: null, text: 'legs are so  sore' },
        ],
    }, byKey, exercises)
    const [tired, pain, sore] = signals
    check('each signal takes the date and source of the text it names, sorted by date', signals.map((s) => `${s.date}:${s.source}:${s.kind}`).join() === '2026-10-13:note:tired,2026-10-15:ronnie:pain,2026-10-16:ronnie:sore', JSON.stringify(signals))
    check('pain keeps its joint and the exercise it was about, by the user\'s own list', pain.joint === 'elbow' && pain.exerciseId === 'ex-bench' && pain.nameZh === '槓鈴臥推' && pain.text === '右手肘有點痛', JSON.stringify(pain))
    check('only pain has a joint', tired.joint === undefined && sore.joint === undefined)
    check('words match the text with spaces and case aside, and are kept as the model copied them', sore.text === 'legs are so  sore')

    const dropped = w.checkedSignals({
        signals: [
            { from: 't2', kind: 'pain', joint: 'elbow', text: '左膝很痛' },
            { from: 't9', kind: 'sick', text: '感冒' },
            { from: 't1', kind: 'injured', text: '有點累' },
            { from: 't1', kind: 'tired', text: '' },
            { from: 't2', kind: 'pain', joint: 'hamstring', exercise: 'x99', text: '有點痛' },
            { from: 't2', kind: 'pain', joint: null, text: '手肘有點痛' },
        ],
    }, byKey, exercises)
    check('words not in the text are made up and dropped; so is an unknown text, an unknown kind or no words', dropped.length === 1, JSON.stringify(dropped))
    check('a joint outside the list and an unknown exercise are left out, the signal kept; the same pain again that day is one', !dropped[0].joint && !dropped[0].exerciseId && dropped[0].text === '有點痛', JSON.stringify(dropped))

    const variant = w.checkedSignals({ signals: [{ from: 't1', kind: 'tired', text: '睡不好,有點累' }, { from: 't4', kind: 'sore', text: '腿很酸' }] },
        w.weekKeys([...TEXTS, { date: '2026-10-17', source: 'ronnie', text: '手腕痛，然後腿很痠' }]).byKey, exercises)
    check('a copy differing only in a full-width comma or 痠 written 酸 is the same words', variant.length === 2, JSON.stringify(variant))

    const many = w.checkedSignals({ signals: Array.from({ length: 30 }, (_, i) => ({ from: 't1', kind: ['pain', 'sore', 'tired', 'sick', 'away'][i % 5], joint: ['shoulder', 'elbow', 'knee', 'wrist', 'hip', 'ankle'][i % 6], text: '累' })) }, byKey, exercises)
    check('at most 12 signals', many.length <= 12, String(many.length))

    const long = Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-1${i}`, source: 'ronnie', text: String(i).repeat(2000) }))
    const { kept } = w.weekKeys(long)
    check('the texts read are capped at 12,000 characters, the latest kept in order', kept.length === 6 && kept[0].date === '2026-10-14' && kept.at(-1).date === '2026-10-19', kept.map((t) => t.date).join())
}

// ---------- Reading the period ----------

function fakeClient(answer) {
    const calls = []
    return {
        calls,
        messages: {
            create: async (params) => {
                calls.push(params)
                if (answer instanceof Error) throw answer
                return { model: w.WEEK_READER_MODEL, stop_reason: 'tool_use', usage: { input_tokens: 400, output_tokens: 60 }, content: answer ? [{ type: 'tool_use', name: 'submit_signals', input: answer }] : [{ type: 'text', text: 'no' }] }
            },
        },
    }
}
{
    const none = fakeClient({ signals: [] })
    const empty = await w.readWeek(none, [{ date: '2026-10-13', source: 'note', text: '  ' }], { own: [BENCH] })
    check('nothing written this period: no call, nothing read', empty.call === null && none.calls.length === 0 && empty.read.texts === 0 && empty.read.model === null && !empty.read.failed, JSON.stringify(empty))

    const client = fakeClient({ signals: [{ from: 't2', kind: 'pain', joint: 'elbow', text: '右手肘有點痛' }] })
    const r = await w.readWeek(client, TEXTS, { own: [BENCH] })
    const prompt = client.calls[0]?.messages[0].content ?? ''
    check('the texts go in by key with their day and where they were written, with the user\'s exercises', prompt.includes('<text key="t1" date="2026-10-13" from="day note">\n睡不好，有點累\n</text>')
        && prompt.includes('<text key="t2" date="2026-10-15" from="message to the coach">') && prompt.includes('Barbell Bench Press / 槓鈴臥推') && client.calls[0].tool_choice?.name === 'submit_signals', prompt.slice(0, 400))
    check('a read says how many texts it read and keeps the signals that check out', r.read.texts === 3 && r.read.model === w.WEEK_READER_MODEL && r.read.signals.length === 1 && r.call.prompt === prompt && r.call.error === null, JSON.stringify(r.read))

    for (const [name, c] of [['an API error', fakeClient(new Error('overloaded'))], ['an answer without the tool', fakeClient(null)]]) {
        const f = await w.readWeek(c, TEXTS, { own: [] })
        check(`${name} leaves no signals, says it failed, and gives the error for the trace`, f.read.failed === true && f.read.model === null && f.read.signals.length === 0 && f.read.texts === 3 && f.call?.error, JSON.stringify(f))
    }
    const late = fakeClient({ signals: [] })
    const out = await w.readWeek(late, TEXTS, { own: [], deadline: Date.now() + 500 })
    check('out of time: no call, and it says it failed', late.calls.length === 0 && out.read.failed === true)
}

// ---------- From the database ----------

function fakeDb(rows) {
    const calls = []
    return {
        calls,
        from(table) {
            const q = { table, filters: [] }
            calls.push(q)
            const chain = {
                select: (c) => ((q.select = c), chain),
                eq: (k, v) => (q.filters.push(`${k}=${v}`), chain),
                gte: (k, v) => (q.filters.push(`${k}>=${v}`), chain),
                lte: (k, v) => (q.filters.push(`${k}<=${v}`), chain),
                order: () => chain,
                then: (ok, no) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok, no),
            }
            return chain
        },
    }
}
{
    const db = fakeDb({
        ronnie_conversations: [
            {
                conversation_date: '2026-10-15',
                display: [
                    { kind: 'event', text: '[app] Finished Push Day' },
                    { kind: 'user', text: '今天臥推手肘有點痛' },
                    { kind: 'assistant', text: 'Your elbow hurts? Try a lighter weight.' },
                    { kind: 'user', text: '   ' },
                ],
            },
            { conversation_date: '2026-10-16', display: null },
        ],
    })
    const messages = await w.fetchMessages(db, 'u1', '2026-10-12', '2026-10-18')
    const q = db.calls[0]
    check('only the user\'s own lines to Ronnie are read: not Ronnie\'s replies, the app\'s events or blank lines', messages.length === 1 && messages[0].text === '今天臥推手肘有點痛' && messages[0].date === '2026-10-15' && messages[0].source === 'ronnie', JSON.stringify(messages))
    check('the conversations read are the user\'s, within the period', q.table === 'ronnie_conversations' && q.filters.join() === 'user_id=u1,conversation_date>=2026-10-12,conversation_date<=2026-10-18', JSON.stringify(q))

    const mem = fakeDb({
        ronnie_memories: [
            { kind: 'injury', subject: 'knee', state: 'active', note: '左膝有舊傷', updated_at: '2026-10-13T20:00:00Z' },
            { kind: 'mood', subject: null, state: 'active', note: 'x', updated_at: '2026-10-13T20:00:00Z' },
            { kind: 'equipment', subject: null, state: 'active', note: '健身房沒有輔助引體機', updated_at: '2026-10-14T01:00:00Z' },
        ],
    })
    const taipei = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    const notes = await w.fetchMemory(mem, 'u1', (iso) => taipei.format(new Date(iso)))
    check('Ronnie\'s notes keep their text, kind and state, dated in the user\'s time zone; an unknown kind is dropped', notes.length === 2 && notes[0].text === '左膝有舊傷' && notes[0].date === '2026-10-14' && notes[0].subject === 'knee' && notes[1].kind === 'equipment', JSON.stringify(notes))
    check('the notes read are the user\'s', mem.calls[0].table === 'ronnie_memories' && mem.calls[0].filters.join() === 'user_id=u1')
}

// ---------- In the report ----------

const set = (exerciseId, date, weightKg, reps) => ({ date, workoutId: `w-${date}`, exerciseId, reps, weightKg, durationS: null, speedKmh: null, distanceM: null, assistKg: null, loggedAt: `${date}T18:00:00Z` })
const base = {
    periodStart: '2026-10-12', periodEnd: '2026-10-18', exercises: [BENCH, SQUAT], schedule: null, weighIns: [], goal: null, routineLeads: [], previousFindings: null, notes: [],
    sets: [1, 2, 3].flatMap(() => [set('ex-bench', '2026-10-12', 42.5, 8), set('ex-squat', '2026-10-14', 65, 8)]),
}
{
    const note = (i) => ({ kind: 'other', subject: `n${i}`, state: 'active', text: `note ${i}`, date: '2026-10-01' })
    const week = { signals: [{ date: '2026-10-15', source: 'ronnie', kind: 'pain', joint: 'elbow', text: '右手肘有點痛' }], texts: 3, model: 'm' }
    const facts = w.computeFacts({ ...base, memory: [{ kind: 'injury', subject: 'knee', state: 'active', text: '左膝有舊傷', date: '2026-10-14' }], weekRead: week })
    check('the report keeps Ronnie\'s notes and the period as read', facts.context?.memory.length === 1 && facts.context.week === week, JSON.stringify(facts.context))
    check('where the period isn\'t read (evals, older code) there is no context', !('context' in w.computeFacts(base)))
    const capped = w.computeFacts({ ...base, memory: Array.from({ length: 150 }, (_, i) => note(i)), weekRead: week }).context.memory
    check('at most 100 notes, the latest kept', capped.length === 100 && capped[0].subject === 'n50' && capped.at(-1).subject === 'n149')

    // The advice doesn't change in this PR: neither the notes nor what was said reach the model
    const analysis = w.analyze({ ...base, memory: [{ kind: 'injury', subject: 'knee', state: 'active', text: '左膝有舊傷', date: '2026-10-14' }], weekRead: week })
    const prompt = w.buildPrompt({ ...analysis, note: null, language: 'zh-TW', weightUnit: 'kg' })
    check('the narrative prompt has neither Ronnie\'s notes nor what was said this period', !prompt.includes('左膝有舊傷') && !prompt.includes('右手肘有點痛'))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
