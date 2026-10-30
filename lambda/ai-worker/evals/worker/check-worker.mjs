#!/usr/bin/env node
// Free check of how the report worker treats a request (no model, no database): a message only
// names its request, and the period and the note come from the row; a message runs only while
// its row is pending with the message's queued_at, every save is limited to that row, a failed
// row keeps no error text, a period
// is 1 to 28 days, a model call can't outlast the Lambda, a text that fails its checks is retried
// with the problems and then replaced by the app's own labels, and the brief gives the app's
// Chinese words.
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
    ['a missing row is not run', null, request, false],
]) {
    const r = await w.isRunnable(fakeSupabase(row), req)
    check(name, r.run === run, `run ${r.run} (${r.why})`)
}
{
    const r = await w.isRunnable(fakeSupabase({ status: 'pending', queued_at: QUEUED, period_end: '2026-10-11', user_note: 'Slept badly' }), request)
    check('a runnable row gives its own period end and note', r.run && r.periodEnd === '2026-10-11' && r.userNote === 'Slept badly', JSON.stringify(r))
}

// A message names its request, and nothing else in it is read
const USER = '7d3c1e2a-5b6f-4a8e-9c0d-1e2f3a4b5c6d'
const message = { userId: USER, periodStart: '2026-10-05', queuedAt: QUEUED }
for (const [name, body, ok] of [
    ['a scheduler message is a request', JSON.stringify(message), true],
    ['a queued_at as the database writes it (+00:00) is a request', JSON.stringify({ ...message, queuedAt: '2026-10-13T00:00:05.123+00:00' }), true],
    ['a message without queued_at is dropped', JSON.stringify({ ...message, queuedAt: undefined }), false],
    ['a user id that is not a UUID is dropped', JSON.stringify({ ...message, userId: 'u1' }), false],
    ['an impossible date is dropped', JSON.stringify({ ...message, periodStart: '2026-13-01' }), false],
    ['a body that is not JSON is dropped', 'not json', false],
]) {
    const r = w.parseRequest(body)
    check(name, (r !== null) === ok, JSON.stringify(r))
}
{
    const r = w.parseRequest(JSON.stringify({ ...message, periodEnd: '2099-12-31', userNote: 'x'.repeat(100_000), language: 'xx' }))
    check('a period end, note or language in a message is ignored', Object.keys(r ?? {}).sort().join() === 'periodStart,queuedAt,userId', JSON.stringify(Object.keys(r ?? {})))
}

// The period a report covers: 1 day to the longest cycle
for (const [name, start, end, days] of [
    ['a week', '2026-10-05', '2026-10-11', 7],
    ['one day', '2026-10-05', '2026-10-05', 1],
    [`${w.MAX_CYCLE_DAYS} days, the longest cycle`, '2026-10-01', '2026-10-28', 28],
    ['29 days is too long', '2026-10-01', '2026-10-29', null],
    ['an end before the start', '2026-10-05', '2026-10-04', null],
    ['no end', '2026-10-05', null, null],
    ['decades', '2026-10-05', '2099-12-31', null],
]) {
    check(`period: ${name}`, w.periodDays(start, end) === days, String(w.periodDays(start, end)))
}

// A period is the user's calendar week, Monday to Sunday, whatever their training cycle
{
    const at = (iso) => new Date(iso)
    const range = (p) => `${p.periodStart}..${p.periodEnd}`
    check('on a Wednesday, the report due is last week\'s, Monday to Sunday',
        range(w.lastCompletedPeriod('America/New_York', at('2026-10-28T14:00:00Z'))) === '2026-10-19..2026-10-25'
        && range(w.currentPeriod('America/New_York', at('2026-10-28T14:00:00Z'))) === '2026-10-26..2026-11-01')
    // Sunday 16:30 UTC is Monday 00:30 in Taipei and still Sunday in New York
    check('the week ends at midnight in the user\'s own time zone',
        range(w.lastCompletedPeriod('Asia/Taipei', at('2026-11-01T16:30:00Z'))) === '2026-10-26..2026-11-01'
        && range(w.lastCompletedPeriod('America/New_York', at('2026-11-01T16:30:00Z'))) === '2026-10-19..2026-10-25')
}

// A week an earlier report already covered to its end gets no second report
{
    const week = { userId: 'u1', periodStart: '2026-10-27', periodEnd: '2026-11-02' }
    const due = (end) => w.weeksNotReported([week], new Map(end ? [['u1', end]] : [])).length === 1
    check('a week with no report before it is due', due(null))
    check('a round of a cycle that ended inside the week leaves it due, so no day goes unreported', due('2026-10-28'))
    check('a round that ended on or after its Sunday covered it, and this week\'s own report is not made twice', !due('2026-11-02') && !due('2026-11-05'))
    check('one user\'s reports leave another user\'s week due', w.weeksNotReported([week, { ...week, userId: 'u2' }], new Map([['u1', '2026-11-02']])).map((d) => d.userId).join() === 'u2')
}

// Every save is an update limited to this request's row: never an upsert, never another request's
for (const [name, save] of [
    ['saveReport', (sb) => w.saveReport(sb, request, { version: 3 }, null)],
    ['saveFailedStatus', (sb) => w.saveFailedStatus(sb, request, 'error')],
    ['saveInsufficientDataStatus', (sb) => w.saveInsufficientDataStatus(sb, request, { version: 3, statsOnly: true, facts: { totalSets: { now: 4 } } }, 10)],
]) {
    const sb = fakeSupabase(null)
    await save(sb)
    const q = sb.queries.at(-1)
    const has = (col, val) => q.filters.some(([c, v]) => c === col && v === val)
    check(`${name} updates only the pending row of this request`, q.kind === 'update' && has('user_id', 'u1') && has('period_start', '2026-10-05') && has('status', 'pending') && has('queued_at', QUEUED),
        `${q.kind} with ${JSON.stringify(q.filters)}`)
}

// A week below the sets advice needs: its numbers alone, saved on its row, with no rules and no model call
{
    const sc = SCENARIOS.find((x) => x.id === 'goal-strength-owner-zh')
    const full = inputsFor(sc)
    // This week, only the chest day: bench 3 and lateral raise 3
    const thin = { ...full, sets: full.sets.filter((s) => s.date < full.periodStart || s.date === full.periodStart), goalRead: undefined }
    const stats = w.statsOf(thin, sc.goalRead)
    check('a thin week is its numbers alone: 6 sets on 1 day, and no findings or text',
        w.isReportStats(stats) && stats.facts.totalSets.now === 6 && stats.facts.sessions.done === 1 && !('findings' in stats) && !('narrative' in stats) && !w.isEmptyWeek(stats),
        JSON.stringify({ sets: stats.facts.totalSets, done: stats.facts.sessions.done, keys: Object.keys(stats) }))
    check('it shows the goal as read before while the text is the same, with each target\'s progress',
        stats.facts.goal.read === sc.goalRead && stats.facts.goal.progress?.length === 3, JSON.stringify(stats.facts.goal.progress?.map((p) => p.target.kind)))
    const changed = w.statsOf({ ...thin, goal: '深蹲 170 公斤' }, sc.goalRead)
    check('a goal text not read yet is left out, not read: the week makes no model call',
        !('read' in changed.facts.goal) && !('progress' in changed.facts.goal) && changed.facts.goal.text === '深蹲 170 公斤', JSON.stringify(changed.facts.goal))
    check('without a goal, the goal is null, so the report asks for one', w.statsOf({ ...thin, goal: null }, sc.goalRead).facts.goal.read === null)
    check('what was said this period is not read either', !('context' in stats.facts))
    const empty = w.statsOf({ ...full, sets: full.sets.filter((s) => s.date < full.periodStart), goalRead: undefined }, sc.goalRead)
    check('a week with nothing logged is an empty week', w.isEmptyWeek(empty) && empty.facts.totalSets.now === 0)
    check('a full report is not read as numbers alone', !w.isReportStats({ version: 3, facts: stats.facts, findings: [], narrative: { headline: '', items: [] } }))

    const sb = fakeSupabase(null)
    await w.saveInsufficientDataStatus(sb, request, stats, 10)
    const v = sb.queries.at(-1).values
    check('the numbers are saved on the row, as insufficient_data', v.status === 'insufficient_data' && v.recommendation === stats && v.error_message === 'Only 6 sets logged this period (minimum 10 required for analysis).',
        JSON.stringify({ status: v.status, error_message: v.error_message }))
}

// A failed row says a fixed line: an error's own text can name AWS resources, and the row is the user's
for (const [reason, line] of [['error', 'The report could not be made.'], ['invalid_period', 'Invalid report period.']]) {
    const sb = fakeSupabase(null)
    await w.saveFailedStatus(sb, request, reason)
    const m = sb.queries.at(-1).values?.error_message
    check(`a failed row (${reason}) says "${line}", not the error`, m === line, JSON.stringify(m))
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

// Low muscles: code writes the lead and a line per muscle with both options; the model adds only
// a sentence for a note, empty without one, held to its length
{
    // With a goal: without one the report gives no volume advice
    const sc = { ...SCENARIOS.find((x) => x.id === 'first-report-zh'), goal: '增肌' }
    const a = w.analyze(inputsFor(sc))
    const zhInput = { ...a, note: null, language: 'zh-TW', weightUnit: 'kg' }
    const lows = a.findings.filter((f) => f.rule === 'low_volume')
    const run = async (lowText) => {
        const c = client([{ headline: '第一份報告，先記下你的基準。', actions: { low_volume: lowText } }])
        const r = await quiet(() => w.generateNarrative(zhInput, 'claude-sonnet-4-6', { client: c }))
        return { calls: c.calls.length, r, item: r.narrative?.items.find((i) => i.rule === 'low_volume') }
    }
    const plain = await run('')
    const lines = plain.item?.lines ?? []
    const named = lows.every((f) => lines.some((l) => [f.data.addToZh, f.data.newExerciseZh].filter(Boolean).every((x) => l.text.includes(x))))
    check('no note: the action is code\'s lead, with a line per low muscle naming its options', plain.calls === 1 && plain.item?.action === '每個部位選一種方式補上組數。' && lines.length === lows.length && named,
        JSON.stringify(plain.r.narrative ?? plain.r))
    check('a line reads as the app writes it', lines.some((l) => l.label === '二頭' && l.text === '槓鈴彎舉每週多做 2 組，或新增啞鈴彎舉，每週 2 組'), JSON.stringify(lines))
    const unnoted = await run('沒有備註，照程式列出的選項擇一即可。')
    check('without a note, a low_volume sentence is dropped: the action is the lead alone', unnoted.item?.action === '每個部位選一種方式補上組數。', JSON.stringify(unnoted.item))
    const withNote = { ...zhInput, dayNotes: [{ date: a.facts.period.start, note: '做臉拉左肩有點緊', routine: null, trained: true }] }
    const nc = client([{ headline: '第一份報告，先記下你的基準。', actions: { low_volume: '肩後束先用反向蝴蝶機，從輕重量開始。' } }])
    const noted = await quiet(() => w.generateNarrative(withNote, 'claude-sonnet-4-6', { client: nc }))
    check('with a note, its sentence comes after the lead', noted.narrative?.items.find((i) => i.rule === 'low_volume')?.action === '每個部位選一種方式補上組數。肩後束先用反向蝴蝶機，從輕重量開始。', JSON.stringify(noted.narrative ?? noted))
    const long = w.textProblems({ headline: '基準。', items: [{ rule: 'low_volume', action: '背'.repeat(51) }] }, zhInput)
    check('text check: a low_volume sentence over 50 characters', long.some((x) => /low_volume text is 51 characters/.test(x)), JSON.stringify(long))
    const one = w.fallbackNarrative(w.analyze(inputsFor(SCENARIOS.find((x) => x.id === 'shoulder-pain-note-zh'))).facts, w.analyze(inputsFor(SCENARIOS.find((x) => x.id === 'shoulder-pain-note-zh'))).findings, 'zh-TW')
    check('one low muscle gets the one-muscle lead', one.items.find((i) => i.rule === 'low_volume')?.action === '選一種方式補上組數。', JSON.stringify(one.items))
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

// Retention: an unflagged trace goes after 90 days, a flagged one after 365, app errors after 90
{
    const calls = []
    const fake = { from(table) {
        const q = { table, ops: [] }
        calls.push(q)
        const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ error: null }) : (...args) => { q.ops.push([k, ...args]); return b }) })
        return b
    } }
    const now = Date.parse('2026-10-20T12:00:00Z')
    await w.deleteExpired(fake, now)
    const days = (iso) => Math.round((now - Date.parse(iso)) / 86_400_000)
    const read = calls.map((q) => `${q.table}: ${q.ops.map(([k, ...a]) => (k === 'lt' ? `before ${days(a[1])} days` : k === 'is' ? `${a[0]} ${a[1]}` : k)).join(', ')}`)
    check('retention: unflagged traces 90 days, flagged 365, app errors 90', JSON.stringify(read) === JSON.stringify([
        'ai_traces: delete, before 90 days, flagged_at null',
        'ai_traces: delete, before 365 days',
        'app_errors: delete, before 90 days',
    ]), JSON.stringify(read))
}

// The app's labels stand in for any report: every scenario, both languages, nothing left in
// braces, and they pass the same text checks
{
    const problems = []
    for (const sc of SCENARIOS) {
        const a = w.analyze(inputsFor(sc))
        for (const language of ['en', 'zh-TW']) {
            const n = w.fallbackNarrative(a.facts, a.findings, language)
            const text = [n.headline, ...n.items.flatMap((i) => [i.action, ...(i.lines ?? []).flatMap((l) => [l.label, l.text])])].join(' ')
            if (/[{}]/.test(text)) problems.push(`${sc.id} ${language}: ${text}`)
            const lows = a.findings.filter((f) => f.rule === 'low_volume')
            const lines = n.items.find((i) => i.rule === 'low_volume')?.lines ?? []
            if (lines.length !== lows.length) problems.push(`${sc.id} ${language}: ${lines.length} lines for ${lows.length} low muscles`)
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

// The plan: a cycle that started after the period planned nothing in it; a day the user made a rest
// day plans nothing either, and a day they gave another routine (or a rest day they gave one) plans that
{
    const routine = (id, name, owner, exercise) => ({ id, user_id: owner, name, routine_exercises: [{ exercise_id: exercise, target_sets: 4 }] })
    const ROUTINES = { push: routine('push', 'Push', 'u1', 'e1'), legs: routine('legs', 'Legs', 'u1', 'e2'), theirs: routine('theirs', 'Theirs', 'u2', 'e9') }
    // The cycle has Push on its first day only; changes are [date, routine id or null]
    const fake = (startDate, owner = 'u1', changes = []) => ({
        from(table) {
            // The changes the read asks for: those in the period
            const range = {}
            const changed = () => changes
                .filter(([d]) => (!range.gte || d >= range.gte) && (!range.lte || d <= range.lte))
                .map(([change_date, id]) => ({ change_date, routine_id: id, routines: id ? ROUTINES[id] : null }))
            const data = () => table === 'training_cycles' ? { id: 'c1', cycle_length: 7, start_date: startDate, cycle_date_changes: changed() }
                : [{ day_index: 1, routine_id: 'push', routines: { ...ROUTINES.push, user_id: owner } }]
            const b = {
                select: () => b, eq: () => b, maybeSingle: () => b,
                gte: (column, value) => { if (column === 'cycle_date_changes.change_date') range.gte = value; return b },
                lte: (column, value) => { if (column === 'cycle_date_changes.change_date') range.lte = value; return b },
                then: (r) => r({ data: data(), error: null }),
            }
            return b
        },
    })
    const plans = (schedule) => JSON.stringify(schedule?.map((d) => [d.date, d.routine, d.plan.map((p) => p.exerciseId)]))
    const before = await w.fetchSchedule(fake('2026-09-01'), 'u1', '2026-10-05', 7)
    const after = await w.fetchSchedule(fake('2026-10-13'), 'u1', '2026-10-05', 7)
    const midway = await w.fetchSchedule(fake('2026-10-08'), 'u1', '2026-10-05', 7)
    check('a cycle that started before the period gives its plan', before?.length === 7 && before.some((d) => d.routine === 'Push'), JSON.stringify(before))
    check('a cycle that started after the period gives no plan, not 0 planned', after === null, JSON.stringify(after))
    const theirs = await w.fetchSchedule(fake('2026-09-01', 'u2'), 'u1', '2026-10-05', 7)
    check("a day pointing at another user's routine plans nothing from it", theirs?.length === 7 && theirs.every((d) => d.routine === null && !d.plan.length), JSON.stringify(theirs?.map((d) => d.routine)))
    check('a cycle that started during the period plans from its first day', midway?.length === 7 && midway.slice(0, 3).every((d) => d.routine === null) && midway[3].routine === 'Push', JSON.stringify(midway?.map((d) => d.routine)))
    // Push is on 10/6; the user made that day a rest day, and one in the next period too
    const rested = await w.fetchSchedule(fake('2026-09-01', 'u1', [['2026-10-06', null], ['2026-10-13', null]]), 'u1', '2026-10-05', 7)
    check('a day the user made a rest day plans nothing: not a missed session, and no sets it would have added',
        before?.find((d) => d.date === '2026-10-06')?.routine === 'Push' && rested?.length === 7 && rested.every((d) => d.routine === null && !d.plan.length),
        JSON.stringify(rested?.map((d) => [d.date, d.routine])))
    const nextWeek = await w.fetchSchedule(fake('2026-09-01', 'u1', [['2026-10-06', null]]), 'u1', '2026-10-12', 7)
    check("a rest day in another period leaves this one's plan alone", nextWeek?.find((d) => d.date === '2026-10-13')?.routine === 'Push', JSON.stringify(nextWeek?.map((d) => [d.date, d.routine])))
    // 10/6 given Legs instead of Push, and Thursday's rest day (10/8) given Push
    const swapped = await w.fetchSchedule(fake('2026-09-01', 'u1', [['2026-10-06', 'legs'], ['2026-10-08', 'push']]), 'u1', '2026-10-05', 7)
    const day = (date) => swapped?.find((d) => d.date === date)
    check("a day given another routine plans that routine's sets, and not the one it replaced",
        day('2026-10-06')?.routine === 'Legs' && JSON.stringify(day('2026-10-06')?.plan) === JSON.stringify([{ exerciseId: 'e2', sets: 4 }]), plans(swapped))
    check('a rest day given a routine plans it, and the other days keep the cycle\'s',
        day('2026-10-08')?.routine === 'Push' && swapped?.filter((d) => d.routine).length === 2, plans(swapped))
    const foreign = await w.fetchSchedule(fake('2026-09-01', 'u1', [['2026-10-06', 'theirs']]), 'u1', '2026-10-05', 7)
    check("a day changed to another user's routine plans nothing from it", foreign?.every((d) => d.routine === null && !d.plan.length), plans(foreign))
}

// The AI error alarms count failures: a Ronnie turn the user stopped is traced as an error, and isn't one
for (const [error, stopped] of [
    ['aborted: Request was aborted.', true], ['Request was aborted.', true], ['This operation was aborted', true], ['Aborted', true],
    ['error: Overloaded', false], ['Request timed out.', false], ['The operation was aborted due to timeout', false], ['401 invalid x-api-key', false], [null, false],
]) {
    check(`a trace error ${JSON.stringify(error)} ${stopped ? 'is the user stopping, not counted' : 'is counted as a failure'}`, w.stoppedByUser(error) === stopped)
}

// The daily reminder (src/reminders.ts): at 21:00 in each user's own time zone, one question, and only to push services
{
    const at = (iso) => new Date(iso)
    const due = (iso, profiles) => w.dueReminders(profiles, at(iso)).map((d) => `${d.userId}:${d.today}:${d.language}`).join()
    const PEOPLE = [{ user_id: 'tw', timezone: 'Asia/Taipei', language: 'zh-TW' }, { user_id: 'ny', timezone: 'America/New_York', language: 'en' }]
    check('21:30 in Taipei is Taipei\'s reminder, not New York\'s (09:30 there)', due('2026-10-30T13:30:00Z', PEOPLE) === 'tw:2026-10-30:zh-TW')
    check('21:15 in New York is the reminder of its own date, a day behind Taipei', due('2026-10-31T01:15:00Z', PEOPLE) === 'ny:2026-10-30:en')
    check('after the clocks go back (EST), 21:00 in New York is 02:00 UTC', due('2026-11-02T02:00:00Z', PEOPLE) === 'ny:2026-11-01:en' && due('2026-11-02T01:00:00Z', PEOPLE) === '')
    check('20:59 is not yet the reminder\'s hour', due('2026-10-30T12:59:00Z', PEOPLE) === '')
    check('a profile with no language set gets English', w.dueReminders([{ user_id: 'x', timezone: 'Asia/Taipei', language: null }], at('2026-10-30T13:00:00Z'))[0]?.language === 'en')
    check('local hours run 0 to 23, midnight as 0', w.localHour('Asia/Taipei', at('2026-10-30T16:00:00Z')) === 0 && w.localHour('Asia/Taipei', at('2026-10-30T15:00:00Z')) === 23)

    const p0 = w.reminderPayload('zh-TW')
    check('one question, in the user\'s language', p0.body === '今天訓練了嗎？' && w.reminderPayload('en').body === 'Did you train today?', p0.body)
    check('a tap opens Today, and a newer reminder replaces an older one', p0.url === '/dashboard' && p0.tag === 'daily-reminder' && p0.title === 'GymPro')

    for (const [ep, ok] of [
        ['https://fcm.googleapis.com/fcm/send/abc:APA91b-xyz', true], ['https://web.push.apple.com/QGuQyavXutnMH0', true],
        ['https://updates.push.services.mozilla.com/wpush/v2/gAAAA', true], ['https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%3d', true],
        ['http://fcm.googleapis.com/fcm/send/x', false], ['https://evil.example.com/push', false], ['https://127.0.0.1:9001/2018-06-01/runtime', false],
        ['https://fcm.googleapis.com.evil.com/x', false], ['https://web.push.apple.com/a b', false], [`https://web.push.apple.com/${'a'.repeat(1100)}`, false],
    ]) check(`${ok ? 'posts to' : 'refuses'} ${ep.slice(0, 60)}`, w.isPushEndpoint(ep) === ok)

    // One secret: the public key comes from the private one, and web-push builds a request with them
    const keys = w.webpush.generateVAPIDKeys()
    check('the VAPID public key is worked out from the private key', w.vapidPublicKeyOf(keys.privateKey) === keys.publicKey)
    const { createECDH, randomBytes } = await import('node:crypto')
    const device = createECDH('prime256v1'); device.generateKeys()
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: device.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }
    const req = w.webpush.generateRequestDetails(sub, JSON.stringify(p0), {
        vapidDetails: { subject: 'https://gympro.chichi.mom', publicKey: w.vapidPublicKeyOf(keys.privateKey), privateKey: keys.privateKey },
        TTL: 10800, urgency: 'normal', topic: 'daily-reminder',
    })
    check('the request is encrypted for the device, signed with the key, kept 3 hours, and replaces an older reminder',
        req.headers['Content-Encoding'] === 'aes128gcm' && String(req.headers.Authorization).includes(`k=${keys.publicKey}`) && req.headers.TTL === 10800 && req.headers.Topic === 'daily-reminder' && req.body.length > 0,
        JSON.stringify(Object.keys(req.headers)))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nThe worker trusts only the request in a message, runs it once, saves only to its own row, stops in time, and checks its text')
process.exit(failed ? 1 : 0)
