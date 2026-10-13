#!/usr/bin/env node
// Free check of how the report worker treats a request (no model, no database): a message runs
// only while its row is pending with the message's queued_at, every save is limited to that
// row, a model call can't outlast the Lambda, a text that fails its checks is retried with the
// problems and then replaced by the app's own labels, and the brief gives the app's Chinese words.
//   node lambda/ai-worker/evals/worker/check-worker.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputsFor, SCENARIOS } from '../report-v3/scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/worker/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/worker/dist/worker.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const w = createRequire(import.meta.url)(join(here, 'dist', 'worker.cjs'))

let failed = 0
const check = (name, ok, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

/** A stand-in for the service-role client: one period_reports row, and every query it was sent */
function fakeSupabase(row) {
    const queries = []
    return {
        queries,
        from(table) {
            const q = { table, kind: 'select', values: null, filters: [] }
            queries.push(q)
            const b = {
                select: () => b,
                update: (values) => { q.kind = 'update'; q.values = values; return b },
                upsert: (values) => { q.kind = 'upsert'; q.values = values; return b },
                eq: (col, val) => { q.filters.push([col, val]); return b },
                maybeSingle: () => b,
                then: (resolve) => resolve({ data: q.kind === 'select' ? row : [{ user_id: 'u1' }], error: null }),
            }
            return b
        },
    }
}

const QUEUED = '2026-10-13T00:00:05.123Z'
const request = { userId: 'u1', periodStart: '2026-10-05', queuedAt: QUEUED }

// Which messages run
for (const [name, row, req, run] of [
    ['a pending row with the message\'s queued_at runs', { status: 'pending', queued_at: '2026-10-13T00:00:05.123+00:00' }, request, true],
    ['a completed row is not run again (redelivered message)', { status: 'completed', queued_at: QUEUED }, request, false],
    ['a failed row is not run again (redelivery after a caught failure)', { status: 'failed', queued_at: QUEUED }, request, false],
    ['a row a retry re-queued is not run by the old message', { status: 'pending', queued_at: '2026-10-13T00:20:00.000Z' }, request, false],
    ['a message from before queued_at runs on the status alone', { status: 'pending', queued_at: '2026-10-13T00:20:00.000Z' }, { ...request, queuedAt: undefined }, true],
    ['a missing row is not run', null, request, false],
]) {
    const r = await w.isRunnable(fakeSupabase(row), req)
    check(name, r.run === run, `run ${r.run} (${r.why})`)
}

// Every save is an update limited to this request's row: never an upsert, never another request's
for (const [name, save] of [
    ['saveReport', (sb) => w.saveReport(sb, request, { version: 3 }, null)],
    ['saveFailedStatus', (sb) => w.saveFailedStatus(sb, request, 'boom')],
    ['saveInsufficientDataStatus', (sb) => w.saveInsufficientDataStatus(sb, request, 4, 10)],
]) {
    const sb = fakeSupabase(null)
    await save(sb)
    const q = sb.queries.at(-1)
    const has = (col, val) => q.filters.some(([c, v]) => c === col && v === val)
    check(`${name} updates only the pending row of this request`, q.kind === 'update' && has('user_id', 'u1') && has('period_start', '2026-10-05') && has('status', 'pending') && has('queued_at', QUEUED),
        `${q.kind} with ${JSON.stringify(q.filters)}`)
}

// Stale pending: shown as failed after 30 minutes, not before
const now = Date.parse('2026-10-13T01:00:00Z')
check('pending 29 minutes is still being made', w.shownStatus({ status: 'pending', queued_at: '2026-10-13T00:31:00Z' }, now) === 'pending')
check('pending 31 minutes shows as failed', w.shownStatus({ status: 'pending', queued_at: '2026-10-13T00:29:00Z' }, now) === 'failed')
check('a completed report is shown as it is', w.shownStatus({ status: 'completed', queued_at: '2026-10-01T00:00:00Z' }, now) === 'completed')

// The model call: cut off by the deadline, and never started without time to finish. Its
// per-call log lines are left out of this output.
const log = { log: console.log, warn: console.warn }
const quiet = async (f) => {
    console.log = console.warn = () => {}
    try { return await f() } finally { Object.assign(console, log) }
}
const input = {
    facts: {
        period: { start: '2026-10-05', end: '2026-10-11', days: 7 }, status: 'baseline', liftsSummary: { up: 0, flat: 0, down: 0 },
        sessions: { done: 3, planned: null, days: [] }, totalSets: { now: 30, previous: null }, lifts: [], records: [], muscles: [],
        bodyWeight: { latestKg: null, changeKg: null, weighIns: 0, series: [], trendWindows: 0 }, goal: { text: null, direction: null },
    },
    findings: [], watching: [], followUps: [], note: null, dayNotes: [], language: 'en', weightUnit: 'kg',
}
const reply = (headline) => ({
    model: 'claude-sonnet-4-6', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: 'tool_use', id: 't', name: 'submit_report_text', input: { headline, actions: {} } }],
})
const client = (answers, delayMs = 0) => {
    const calls = []
    const prompts = []
    return {
        calls,
        prompts,
        messages: {
            create: async (params, options) => {
                calls.push(options)
                prompts.push(params.messages[0].content)
                await new Promise((r) => setTimeout(r, delayMs))
                const a = answers[calls.length - 1]
                return typeof a === 'string' ? reply(a) : { ...reply(a.headline), content: [{ type: 'tool_use', id: 't', name: 'submit_report_text', input: a }] }
            },
        },
    }
}
{
    const c = client(['A first week on record.'])
    await quiet(() => w.generateNarrative(input, 'claude-sonnet-4-6', { client: c }))
    const o = c.calls[0]
    check('without a deadline a call still has a 60 s ceiling, not the SDK\'s 10 minutes', o?.timeout === 60_000 && o.signal == null, JSON.stringify(o))
}
{
    const c = client(['A first week on record.'])
    const deadline = Date.now() + 40_000
    await quiet(() => w.generateNarrative(input, 'claude-sonnet-4-6', { client: c, deadline }))
    const o = c.calls[0]
    check('with a deadline the call ends by it, SDK retries included', o?.timeout <= 40_000 && o.signal instanceof AbortSignal, JSON.stringify({ timeout: o?.timeout, signal: String(o?.signal) }))
}
{
    const c = client(['A first week on record.'])
    const err = await quiet(() => w.generateNarrative(input, 'claude-sonnet-4-6', { client: c, deadline: Date.now() + 5_000 })).catch((e) => e)
    check('with too little time left no call is made', c.calls.length === 0 && /Out of time/.test(err?.message), `${c.calls.length} calls, ${err?.message}`)
}
{
    // The first answer is empty, which is retried; by then too little time is left for a second
    // call, so the report gets the app's own labels instead of failing
    const c = client(['', 'A first week on record.'], 200)
    const r = await quiet(() => w.generateNarrative(input, 'claude-sonnet-4-6', { client: c, deadline: Date.now() + 15_100 })).catch((e) => e)
    check('a retry that would outlast the deadline is not started; the app\'s labels stand in', c.calls.length === 1 && /empty text/.test(r?.fallback) && /^Later reports compare/.test(r?.narrative?.headline),
        `${c.calls.length} calls, ${JSON.stringify(r?.narrative ?? r?.message)}`)
}

// The text checks: the eval grade's lines, said so the retry can fix them
{
    const sc = SCENARIOS.find((x) => x.id === 'mockup-week-zh')
    const a = w.analyze(inputsFor(sc))
    const zhInput = { ...a, note: null, language: 'zh-TW', weightUnit: 'kg' }
    const good = { headline: '臥推連續三週停在 82.5 公斤，下週先加次數。', items: [...new Set(a.findings.map((f) => f.rule))].map((rule) => ({ rule, action: `${a.findings.filter((f) => f.rule === rule).map((f) => f.data.nameZh ?? '').join('、')}下週照建議調整。` })) }
    const named = w.textProblems(good, zhInput)
    check('a plain Traditional Chinese text naming every item has no problems', named.length === 0, JSON.stringify(named))
    for (const [name, change, want] of [
        ['Markdown', (n) => ({ ...n, headline: `**${n.headline}**` }), /Markdown/],
        ['half-width punctuation after Chinese', (n) => ({ ...n, headline: '臥推停在 82.5 公斤,下週先加次數。' }), /half-width/],
        ['a weight in lb for a kg user', (n) => ({ ...n, headline: '臥推停在 180 lb，下週先加次數。' }), /in lb/],
        ['a headline over 45 characters', (n) => ({ ...n, headline: '臥'.repeat(46) }), /headline is 46/],
        ['English in a Chinese report', (n) => ({ headline: 'Bench is stuck at 82.5 kg for three weeks.', items: n.items.map((i) => ({ ...i, action: 'Add reps first.' })) }), /not written in Traditional Chinese/],
        ['an item left out', (n) => ({ ...n, items: n.items.map((i) => (i.rule === 'lift_stalled' ? { ...i, action: '先加次數。' } : i)) }), /lift_stalled action doesn't name 槓鈴臥推/],
    ]) {
        const p = w.textProblems(change(good), zhInput)
        check(`text check: ${name}`, p.some((x) => want.test(x)), JSON.stringify(p))
    }
}

// A text that fails the checks is written again with its problems; the second one is kept
{
    const sc = SCENARIOS.find((x) => x.id === 'goal-lift-few-sets-en')
    const a = w.analyze(inputsFor(sc))
    const enInput = { ...a, note: null, language: 'en', weightUnit: 'kg' }
    const c = client([
        { headline: 'One lift is stuck.', actions: { lift_stalled: 'Add reps on every set, then add 5 kg.' } },
        { headline: 'One lift is stuck.', actions: { lift_stalled: 'Barbell Back Squat: add reps on every set, then add 5 kg.' } },
    ])
    const r = await quiet(() => w.generateNarrative(enInput, 'claude-sonnet-4-6', { client: c }))
    check('a text that left an item out is retried with that problem', c.calls.length === 2 && /An earlier answer had these problems.*doesn't name Barbell Back Squat/.test(c.prompts[1]) && !c.prompts[0].includes('An earlier answer'),
        `${c.calls.length} calls; second prompt ends ${JSON.stringify(c.prompts[1]?.slice(-160))}`)
    check('the retried text is kept, not the fallback', r.attempts === 2 && !r.fallback && /^Barbell Back Squat:/.test(r.narrative.items[0].action), JSON.stringify(r))
    const both = client([
        { headline: 'One lift is stuck.', actions: { lift_stalled: 'Add reps.' } },
        { headline: 'One lift is stuck.', actions: { lift_stalled: 'Add **reps**.' } },
    ])
    const f = await quiet(() => w.generateNarrative(enInput, 'claude-sonnet-4-6', { client: both }))
    check('two texts that fail the checks give the app\'s labels', f.fallback && f.narrative.items[0].action === 'Add reps on Barbell Back Squat.' && f.narrative.headline === 'Your main lifts went up.',
        JSON.stringify(f.narrative))
}

// The app's labels stand in for any report: every scenario, both languages, nothing left in
// braces, and they pass the same text checks
{
    const problems = []
    for (const sc of SCENARIOS) {
        const a = w.analyze(inputsFor(sc))
        for (const language of ['en', 'zh-TW']) {
            const n = w.fallbackNarrative(a.facts, a.findings, language)
            const text = [n.headline, ...n.items.map((i) => i.action)].join(' ')
            if (/[{}]/.test(text)) problems.push(`${sc.id} ${language}: ${text}`)
            const p = w.textProblems(n, { ...a, note: sc.note ?? null, language, weightUnit: sc.weightUnit ?? 'kg' })
            if (p.length) problems.push(`${sc.id} ${language}: ${p.join('; ')}`)
        }
    }
    check(`the fallback text works for all ${SCENARIOS.length} scenarios in both languages`, !problems.length, problems.slice(0, 4).join('\n       '))
}

// The app's Chinese words: each one is in the messages in both languages and is a phrase a brief
// uses, and only the Chinese brief gives them
{
    const en = createRequire(import.meta.url)('../../../../messages/en.json')
    const zh = createRequire(import.meta.url)('../../../../messages/zh-TW.json')
    const briefs = SCENARIOS.map((sc) => {
        const a = w.analyze(inputsFor(sc))
        return { language: sc.language, text: w.buildPrompt({ ...a, note: sc.note ?? null, language: sc.language, weightUnit: sc.weightUnit ?? 'kg' }) }
    })
    const problems = []
    for (const [phrase, key] of w.ZH_TERMS) {
        for (const [name, messages] of [['en', en], ['zh-TW', zh]]) {
            const v = w.messageAt(messages, key)
            if (typeof v !== 'string' || !v || /[{}]/.test(v)) problems.push(`${key} in ${name} is ${JSON.stringify(v)}`)
        }
        if (!briefs.some((b) => b.text.toLowerCase().includes(phrase.toLowerCase()))) problems.push(`no brief says "${phrase}"`)
    }
    const line = "The app's Chinese words"
    if (briefs.some((b) => b.language === 'zh-TW' && !b.text.includes(`main lifts = ${w.messageAt(zh, 'reportV3.glossary.mainLifts.term')}`))) problems.push('a Chinese brief has no word list')
    if (briefs.some((b) => b.language !== 'zh-TW' && b.text.includes(line))) problems.push('an English brief has the Chinese word list')
    check(`the brief's ${w.ZH_TERMS.length} Chinese words are the app's`, !problems.length, problems.join('; '))
}

// The plan: a cycle that started after the period planned nothing in it
{
    const fake = (startDate) => ({
        from(table) {
            const data = table === 'training_cycles' ? { id: 'c1', cycle_length: 7, start_date: startDate }
                : [{ day_index: 1, routines: { name: 'Push', routine_exercises: [{ exercise_id: 'e1', target_sets: 4 }] } }]
            const b = { select: () => b, eq: () => b, maybeSingle: () => b, then: (r) => r({ data, error: null }) }
            return b
        },
    })
    const before = await w.fetchSchedule(fake('2026-09-01'), 'u1', '2026-10-05', 7)
    const after = await w.fetchSchedule(fake('2026-10-13'), 'u1', '2026-10-05', 7)
    const midway = await w.fetchSchedule(fake('2026-10-08'), 'u1', '2026-10-05', 7)
    check('a cycle that started before the period gives its plan', before?.length === 7 && before.some((d) => d.routine === 'Push'), JSON.stringify(before))
    check('a cycle that started after the period gives no plan, not 0 planned', after === null, JSON.stringify(after))
    check('a cycle that started during the period plans from its first day', midway?.length === 7 && midway.slice(0, 3).every((d) => d.routine === null) && midway[3].routine === 'Push', JSON.stringify(midway?.map((d) => d.routine)))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nThe worker runs each request once, saves only to its own row, stops in time, and checks its text')
process.exit(failed ? 1 : 0)
