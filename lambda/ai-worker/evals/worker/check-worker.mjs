#!/usr/bin/env node
// Free check of how the report worker treats a request (no model, no database): a message runs
// only while its row is pending with the message's queued_at, every save is limited to that
// row, and a model call can't outlast the Lambda.
//   node lambda/ai-worker/evals/worker/check-worker.mjs
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
    return {
        calls,
        messages: {
            create: async (params, options) => {
                calls.push(options)
                await new Promise((r) => setTimeout(r, delayMs))
                return reply(answers[calls.length - 1])
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
    // The first answer is empty, which is retried; by then too little time is left for a second call
    const c = client(['', 'A first week on record.'], 200)
    const err = await quiet(() => w.generateNarrative(input, 'claude-sonnet-4-6', { client: c, deadline: Date.now() + 15_100 })).catch((e) => e)
    check('a retry that would outlast the deadline is not started', c.calls.length === 1 && /Out of time before attempt 2.*empty text/.test(err?.message), `${c.calls.length} calls, ${err?.message}`)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nThe worker runs each request once, saves only to its own row, and stops in time')
process.exit(failed ? 1 : 0)
