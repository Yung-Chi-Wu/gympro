#!/usr/bin/env node
// Free check of the daily review of Ronnie's conversations and the owner's weekly email
// (src/audit): no model, no database. A day is read once it has ended in the user's own zone, each
// turn with its tools and their results; the reviewer's answer becomes one flag per reply; a day is
// marked read only after its review is saved, so a failed or capped day is read next run and
// nothing twice. The weekly email lists the week's feedback and flagged replies, goes out only when
// there is something, never quotes a conversation, and sets off what users wrote.
//   node lambda/ai-worker/evals/worker/check-audit.mjs
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

// ---------- Stand-ins ----------

/** An in-memory service-role client: tables as arrays, every query it was sent */
function fakeDb(tables) {
    const queries = []
    const run = (q) => {
        queries.push(q)
        const rows = (tables[q.table] ??= [])
        if (q.op === 'insert') { rows.push({ ...q.values }); return { error: null } }
        if (q.op === 'upsert') {
            for (const v of [q.values].flat()) if (!rows.some((r) => r.trace_id === v.trace_id && r.kind === v.kind)) rows.push({ ...v })
            return { error: null }
        }
        const hit = rows.filter((r) => q.filters.every((f) => f(r)))
        if (q.op === 'update') { for (const r of hit) Object.assign(r, q.values); return { data: hit, error: null } }
        const sorted = [...hit].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
        return { data: q.range ? sorted.slice(q.range[0], q.range[1] + 1) : sorted, error: null }
    }
    return {
        tables,
        queries,
        from(table) {
            const q = { table, op: 'select', columns: null, values: null, filters: [], range: null }
            const b = {
                select: (columns) => { q.columns ??= columns; return b },
                insert: (v) => { q.op = 'insert'; q.values = v; return b },
                upsert: (v) => { q.op = 'upsert'; q.values = v; return b },
                update: (v) => { q.op = 'update'; q.values = v; return b },
                eq: (c, v) => { q.filters.push((r) => r[c] === v); return b },
                is: (c, v) => { q.filters.push((r) => (r[c] ?? null) === v); return b },
                gte: (c, v) => { q.filters.push((r) => r[c] >= v); return b },
                lt: (c, v) => { q.filters.push((r) => r[c] < v); return b },
                in: (c, vs) => { q.filters.push((r) => vs.includes(r[c])); return b },
                order: () => b,
                range: (from, to) => { q.range = [from, to]; return b },
                then: (resolve, reject) => { try { resolve(run(q)) } catch (e) { reject(e) } },
            }
            return b
        },
    }
}

/** A stand-in Anthropic client: answer(prompt, n) gives the reviewer's answer, an Error to throw, or { stop_reason } */
function fakeClient(answer, usage = { input_tokens: 10_000, output_tokens: 1_000 }) {
    const calls = []
    return {
        calls,
        messages: {
            create: async (params) => {
                calls.push(params)
                const a = await answer(params.messages[0].content, calls.length)
                if (a instanceof Error) throw a
                return {
                    model: w.AUDIT_MODEL,
                    stop_reason: a.stop_reason ?? 'end_turn',
                    usage,
                    content: [{ type: 'text', text: a.text ?? JSON.stringify(a) }],
                }
            },
        },
    }
}

/** A Ronnie trace as app/api/ai/coach writes it */
function trace(id, user, at, message, { reply = '好的。', own, history = [{ role: 'user', content: 'earlier' }], tools = [], editFrom = null, system = 'RONNIE SYSTEM PROMPT' } = {}) {
    const messages = [
        ...tools.flatMap((t, i) => [
            { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }, { type: 'tool_use', id: `${id}-t${i}`, name: t.name, input: t.input ?? {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${id}-t${i}`, content: t.result }] },
        ]),
        // What Ronnie wrote (own, which the app may add lines to), or the reply itself; null: no closing text (a card's confirmations replace it)
        ...(reply == null || own === null ? [] : [{ role: 'assistant', content: [own ?? reply].flat().map((text) => ({ type: 'text', text })) }]),
    ]
    return {
        id, user_id: user, created_at: at, feature: 'ronnie', status: reply == null ? 'error' : 'ok', audited_at: null,
        input: { language: 'zh-TW', message, editFrom, system, history },
        output: reply == null ? { toolCalls: [] } : { reply, messages },
    }
}

const TAIPEI = 'u-taipei-0000-0000-000000000001'
const NEW_YORK = 'u-newyork-000-0000-000000000002'
const profiles = () => [{ user_id: TAIPEI, timezone: 'Asia/Taipei' }, { user_id: NEW_YORK, timezone: 'America/New_York' }]
// 2026-10-21 12:15 UTC: 20:15 on the 21st in Taipei, 08:15 on the 21st in New York
const NOW = Date.parse('2026-10-21T12:15:00Z')

// ---------- A turn as the reviewer reads it ----------

{
    const t = trace('a1', TAIPEI, '2026-10-20T05:00:00Z', '我今天做了深蹲嗎？', {
        reply: '你今天已經做完深蹲了！',
        tools: [{ name: 'get_today', input: { date: 'today' }, result: '{"done":[]}' }, { name: 'get_training_summary', result: 'x'.repeat(w.MAX_RESULT_CHARS + 500) }],
    })
    const turn = w.turnOf(t)
    check('a turn has its tool calls in order, each with its own result', turn.toolCalls.map((c) => c.name).join() === 'get_today,get_training_summary' && turn.toolCalls[0].result === '{"done":[]}' && JSON.stringify(turn.toolCalls[0].input) === '{"date":"today"}', JSON.stringify(turn.toolCalls))
    check('a long tool result is cut, saying how much was left out', turn.toolCalls[1].result.length < w.MAX_RESULT_CHARS + 100 && turn.toolCalls[1].result.includes('500 more characters'), turn.toolCalls[1].result.slice(-60))
    check('the reply is the one shown', turn.reply === '你今天已經做完深蹲了！')
    check('a turn with no reply (it failed) is not a turn to review', w.turnOf(trace('a2', TAIPEI, '2026-10-20T05:01:00Z', 'hi', { reply: null })) === null)
    const unanswered = w.toolCallsOf([{ role: 'assistant', content: [{ type: 'tool_use', id: 'z', name: 'swap_exercise', input: {} }] }])
    check('a tool call with no result says so', unanswered[0].result === '[no result]', JSON.stringify(unanswered))
    check('an app event is told apart from typed text', w.turnOf(trace('a3', TAIPEI, '2026-10-20T05:02:00Z', `${w.EVENT_PREFIX} The user tapped Confirm`)).event === true && turn.event === false)
    check('an empty history or an edit starts a new conversation', w.turnOf(trace('a4', TAIPEI, '2026-10-20T05:03:00Z', 'hi', { history: [] })).newConversation && w.turnOf(trace('a5', TAIPEI, '2026-10-20T05:04:00Z', 'hi', { editFrom: 0 })).edited && !turn.newConversation)
}

// ---------- Ronnie's words apart from the app's ----------

{
    const saved = w.turnOf(trace('o1', TAIPEI, '2026-10-20T05:00:00Z', '過頭伸展手肘會痛', {
        reply: '📝 我記住了：過頭伸展時手肘會痛\n\n練三頭可以改做三頭下壓。', own: '練三頭可以改做三頭下壓。',
        tools: [{ name: 'remember', input: { kind: 'injury' }, result: 'Saved' }],
    }))
    check('a note receipt the app added is shown apart from Ronnie\'s words', saved.own === '練三頭可以改做三頭下壓。' && saved.appLines.join() === '📝 我記住了：過頭伸展時手肘會痛', JSON.stringify(saved))
    const faked = w.turnOf(trace('o2', TAIPEI, '2026-10-20T05:00:00Z', '我手肘會痛', { reply: '📝 我記住了：手肘會痛\n\n改做三頭下壓。' }))
    check('a receipt Ronnie wrote itself stays in its own words, where the reviewer can see it', faked.own.startsWith('📝') && faked.appLines.length === 0, JSON.stringify(faked))
    const corrected = w.turnOf(trace('o3', TAIPEI, '2026-10-20T05:00:00Z', '我今天做了深蹲嗎', { reply: '你做完深蹲了。\n\n📌 更正：今天還沒有深蹲的紀錄。', own: ['你做完深蹲了。', '📌 更正：今天還沒有深蹲的紀錄。'] }))
    check('the 📌 correction the app appends is the app\'s, not Ronnie\'s', corrected.own === '你做完深蹲了。' && corrected.appLines.join() === '📌 更正：今天還沒有深蹲的紀錄。', JSON.stringify(corrected))
    const card = w.turnOf(trace('o4', TAIPEI, '2026-10-20T05:00:00Z', '把腿推加進腿日', { reply: '✅ 已提議把腿推加進腿日，確認後才會改。', own: null, tools: [{ name: 'propose_routine_change', result: 'Proposed' }] }))
    check('a card\'s confirmations, which replace Ronnie\'s words, are all the app\'s', card.own === '' && card.appLines.length === 1, JSON.stringify(card))
    const stripped = w.turnOf(trace('o5', TAIPEI, '2026-10-20T05:00:00Z', 'q', { reply: '深蹲做完了', own: '**深蹲**做完了' }))
    check('Markdown the app stripped from Ronnie\'s words doesn\'t make them the app\'s', stripped.appLines.length === 0, JSON.stringify(stripped))
    const rendered = w.renderConversation({ userId: TAIPEI, day: '2026-10-20', timeZone: 'Asia/Taipei', language: 'zh-TW', system: 'S', traceIds: ['o1', 'o4'], turns: [saved, card] })
    check('the reviewer reads Ronnie\'s words and the app\'s lines under separate labels', rendered.includes('Ronnie: 練三頭可以改做三頭下壓。\n\nShown with it, written by the app:\n📝 我記住了') && rendered.includes('Ronnie: (nothing of its own)'), rendered)
}

// ---------- Which days are read ----------

{
    const rows = [
        trace('t-done', TAIPEI, '2026-10-20T05:00:00Z', 'a'), // Taipei 13:00 on the 20th: ended
        trace('t-today', TAIPEI, '2026-10-21T02:00:00Z', 'b'), // Taipei 10:00 on the 21st: today
        trace('n-late', NEW_YORK, '2026-10-21T03:30:00Z', 'c'), // New York 23:30 on the 20th: ended, though the 21st in UTC
        trace('n-today', NEW_YORK, '2026-10-21T05:00:00Z', 'd'), // New York 01:00 on the 21st: today
        trace('n-failed', NEW_YORK, '2026-10-20T20:00:00Z', 'e', { reply: null }),
        trace('n-early', NEW_YORK, '2026-10-20T14:00:00Z', 'f', { history: [] }),
    ]
    const zones = new Map(profiles().map((p) => [p.user_id, p.timezone]))
    const days = w.conversationsToReview(rows, (u) => zones.get(u), NOW)
    const summary = days.map((d) => `${d.userId.slice(2, 9)} ${d.day} ${d.turns.map((t) => t.traceId).join('+')} [${d.traceIds.join('+')}]`)
    check('a day is read once it has ended in the user\'s own zone, not in UTC', summary.join(' | ') === 'newyork 2026-10-20 n-early+n-late [n-early+n-failed+n-late] | taipei- 2026-10-20 t-done [t-done]', summary.join(' | '))
    check('a day keeps its language and its last turn\'s system prompt', days.every((d) => d.language === 'zh-TW' && d.system === 'RONNIE SYSTEM PROMPT'))

    const rendered = w.renderConversation({ ...days[0], turns: [days[0].turns[0], { ...days[0].turns[1], newConversation: true }] })
    check('the reviewer sees each turn\'s time in the user\'s zone', rendered.includes('turn 1, 10:00') && rendered.includes('turn 2, 23:30'), rendered)
    check('a later turn that starts over says the chat was cleared; the first turn doesn\'t', rendered.includes('turn 2, 23:30 (the chat was cleared') && !rendered.includes('turn 1, 10:00 ('), rendered)
}

{
    const long = { userId: TAIPEI, day: '2026-10-20', timeZone: 'Asia/Taipei', language: 'zh-TW', system: 'S', traceIds: ['l1', 'l2', 'l3'], turns: ['l1', 'l2', 'l3'].map((id, i) => w.turnOf(trace(id, TAIPEI, `2026-10-20T0${i}:00:00Z`, 'q', { reply: 'r'.repeat(1000) }))) }
    const fit = w.lastTurnsThatFit(long, 2500)
    check('a day too long is read from its last turns that fit, saying how many came before', fit.turns.map((t) => t.traceId).join() === 'l2,l3' && fit.leftOut === 1 && w.buildAuditPrompt(fit).includes("first 1 turns are left out"), JSON.stringify({ ids: fit.turns.map((t) => t.traceId), leftOut: fit.leftOut }))
    check('a day that fits is read whole', w.lastTurnsThatFit(long) === long)
}

// ---------- The reviewer ----------

const day = () => {
    const zones = new Map(profiles().map((p) => [p.user_id, p.timezone]))
    return w.conversationsToReview([
        trace('r1', TAIPEI, '2026-10-20T05:00:00Z', '我今天做了深蹲嗎？', { reply: '你今天已經做完深蹲了！', tools: [{ name: 'get_today', result: '{"done":[]}' }] }),
        trace('r2', TAIPEI, '2026-10-20T05:05:00Z', '不是，我還沒做', { reply: '抱歉，你還沒做深蹲。' }),
    ], (u) => zones.get(u), NOW)[0]
}

{
    const client = fakeClient(() => ({ problems: [
        { turn: 1, kind: 'ungrounded', summary: '說今天做完深蹲，但今天的紀錄裡沒有。' },
        { turn: 1, kind: 'ungrounded', summary: 'the same one again' },
        { turn: 9, kind: 'other', summary: 'a turn the day does not have' },
        { turn: 2, kind: 'other', summary: '長'.repeat(w.MAX_SUMMARY_CHARS + 20) },
    ] }))
    const review = await w.reviewConversation(client, day())
    const call = client.calls[0]
    const schema = call.output_config?.format?.schema ?? {}
    check('the reviewer is the eval judge\'s model, with a JSON schema answer', call.model === w.AUDIT_MODEL && call.output_config?.format?.type === 'json_schema' && call.system === w.AUDIT_SYSTEM && schema.properties?.problems, JSON.stringify({ model: call.model, format: call.output_config?.format?.type, keys: Object.keys(schema) }))
    // Structured output refuses these (400), which zod's toJSONSchema adds to an integer
    const refused = JSON.stringify(schema).match(/"(\$schema|minimum|maximum|exclusiveMinimum|exclusiveMaximum|minLength|maxLength|pattern|format)"/g)
    check('the schema uses no keyword structured output refuses', !refused, String(refused))
    check('every object in the schema closes its properties', (function closed(o) { return typeof o !== 'object' || o === null || ((o.type !== 'object' || o.additionalProperties === false) && Object.values(o).every(closed)) })(schema))
    check('the reviewer reads Ronnie\'s system prompt and the day\'s turns with their tool results', call.messages[0].content.includes('RONNIE SYSTEM PROMPT') && call.messages[0].content.includes('[tool get_today]') && call.messages[0].content.includes('{"done":[]}') && call.messages[0].content.includes('Ronnie: 你今天已經做完深蹲了！'))
    check('the reviewer is told which lines the app writes (📝, 📌)', w.AUDIT_SYSTEM.includes('📝') && w.AUDIT_SYSTEM.includes('📌'))
    check('a problem points at its turn\'s trace; a repeat and a turn the day lacks are dropped', review.problems.map((p) => `${p.traceId}:${p.kind}`).join() === 'r1:ungrounded,r2:other', JSON.stringify(review.problems))
    check('a long summary is cut', review.problems[1].summary.length === w.MAX_SUMMARY_CHARS && review.problems[1].summary.endsWith('…'))
}

for (const [name, answer] of [
    ['a refusal', { stop_reason: 'refusal', problems: [] }],
    ['an answer cut off at max_tokens', { stop_reason: 'max_tokens', problems: [] }],
    ['JSON that does not parse', { text: '{"problems": [' }],
    ['a kind the schema lacks', { problems: [{ turn: 1, kind: 'rude', summary: 'x' }] }],
]) {
    const err = await w.reviewConversation(fakeClient(() => answer), day()).then(() => null, (e) => e)
    check(`${name} is no answer: it throws, with the usage and prompt for the trace`, err && err.prompt?.includes('RONNIE SYSTEM PROMPT') && (answer.text || answer.problems?.[0] ? true : err.usage?.input_tokens === 10_000), err ? err.message : 'did not throw')
}

// ---------- A run ----------

const tables = () => ({
    ai_traces: [
        trace('r1', TAIPEI, '2026-10-20T05:00:00Z', '我今天做了深蹲嗎？', { reply: '你今天已經做完深蹲了！', tools: [{ name: 'get_today', result: '{"done":[]}' }] }),
        trace('r2', TAIPEI, '2026-10-20T05:05:00Z', '不是，我還沒做', { reply: '抱歉，你還沒做深蹲。' }),
        trace('r-today', TAIPEI, '2026-10-21T02:00:00Z', '今天練什麼？'),
        trace('n1', NEW_YORK, '2026-10-20T14:00:00Z', 'What should I train?', { history: [] }),
        trace('n-failed', NEW_YORK, '2026-10-19T14:00:00Z', 'hi', { reply: null }),
        trace('old', NEW_YORK, '2026-10-10T14:00:00Z', 'too old to read'),
        { ...trace('read', NEW_YORK, '2026-10-20T15:00:00Z', 'already read'), audited_at: '2026-10-20T16:00:00Z' },
        { ...trace('other', NEW_YORK, '2026-10-20T15:00:00Z', 'a report'), feature: 'report' },
    ],
    user_profiles: profiles(),
    ai_trace_flags: [{ trace_id: 'r1', user_id: TAIPEI, kind: 'correction' }],
})
const answers = (prompt) => (prompt.includes('我今天做了深蹲嗎')
    ? { problems: [{ turn: 1, kind: 'ungrounded', summary: '說今天做完深蹲，但紀錄裡沒有。' }, { turn: 1, kind: 'false_action', summary: '說記錄了但沒有呼叫工具。' }] }
    : { problems: [] })
const traceRow = (db, id) => db.tables.ai_traces.find((r) => r.id === id)

{
    const db = fakeDb(tables())
    const client = fakeClient(answers)
    const run = await w.runAudit({ supabase: db, client, now: NOW })
    check('one model call per ended day: Taipei\'s 20th and New York\'s 20th', client.calls.length === 2 && run.reviewed.length === 2, `${client.calls.length} calls`)
    check('the day\'s traces are marked read; today\'s, an old one and other features are not touched', ['r1', 'r2', 'n1', 'n-failed'].every((id) => traceRow(db, id).audited_at) && !traceRow(db, 'r-today').audited_at && !traceRow(db, 'old').audited_at && !traceRow(db, 'other').audited_at && traceRow(db, 'read').audited_at === '2026-10-20T16:00:00Z', JSON.stringify(db.tables.ai_traces.map((r) => [r.id, r.audited_at])))
    const audit = db.tables.ai_trace_flags.filter((f) => f.kind === 'audit')
    check('a reply with problems gets one audit flag holding all of them', audit.length === 1 && audit[0].trace_id === 'r1' && audit[0].user_id === TAIPEI && audit[0].detail.problems.map((p) => p.kind).join() === 'ungrounded,false_action', JSON.stringify(audit))
    const reviews = db.tables.ai_traces.filter((r) => r.feature === 'audit')
    check('each review is traced as feature audit, under the day\'s user, with its cost', reviews.length === 2 && reviews.every((r) => r.status === 'ok' && r.cost_usd > 0 && r.input.traceIds.length) && reviews.some((r) => r.user_id === TAIPEI && r.id === audit[0].detail.auditTraceId), JSON.stringify(reviews.map((r) => [r.user_id, r.status, r.cost_usd])))
    check('the reviewer never reads a trace the run doesn\'t review', !client.calls.some((c) => c.messages[0].content.includes('too old to read') || c.messages[0].content.includes('already read') || c.messages[0].content.includes('今天練什麼')))

    const again = fakeClient(answers)
    const second = await w.runAudit({ supabase: db, client: again, now: NOW + 3_600_000 })
    check('a second run reads nothing twice', again.calls.length === 0 && second.reviewed.length === 0, `${again.calls.length} calls`)
}

{
    const db = fakeDb(tables())
    const run = await w.runAudit({ supabase: db, client: fakeClient((prompt) => (prompt.includes('我今天做了深蹲嗎') ? new Error('overloaded') : { problems: [] })), now: NOW })
    check('a failed review leaves its day unread for the next run, and the others go on', !traceRow(db, 'r1').audited_at && !traceRow(db, 'r2').audited_at && traceRow(db, 'n1').audited_at && run.failed.length === 1 && run.reviewed.length === 1)
    const errorTrace = db.tables.ai_traces.find((r) => r.feature === 'audit' && r.status === 'error')
    check('a failed review is traced as an error', errorTrace?.user_id === TAIPEI && errorTrace.error === 'overloaded', JSON.stringify(errorTrace?.error))
}

{
    const db = fakeDb(tables())
    const client = fakeClient(answers)
    const run = await w.runAudit({ supabase: db, client, now: NOW, remainingMs: () => w.KEEP_BACK_MS - 1 })
    check('with too little of the Lambda\'s time left, no day starts and all wait for the next run', client.calls.length === 0 && run.later.length === 2 && !traceRow(db, 'r1').audited_at && !traceRow(db, 'n1').audited_at)
    check('a day of only failed turns is marked read without a model call', traceRow(db, 'n-failed').audited_at)
}

{
    const many = Array.from({ length: w.MAX_DAYS_PER_RUN + 3 }, (_, i) => trace(`m${i}`, `u-many-${String(i).padStart(4, '0')}`, '2026-10-20T14:00:00Z', 'hi'))
    const db = fakeDb({ ai_traces: many, user_profiles: [], ai_trace_flags: [] })
    // A cheap day each, so the count stops the run before the cost does
    const client = fakeClient(() => ({ problems: [] }), { input_tokens: 1_000, output_tokens: 100 })
    const run = await w.runAudit({ supabase: db, client, now: NOW })
    check(`at most ${w.MAX_DAYS_PER_RUN} days a run; the rest wait, unread`, client.calls.length === w.MAX_DAYS_PER_RUN && run.later.length === 3 && many.filter((r) => r.feature === 'ronnie' && !r.audited_at).length === 3, `${client.calls.length} calls, ${run.later.length} later`)
    check('the run asks for Ronnie traces not read yet from the past few days', db.queries.some((q) => q.table === 'ai_traces' && q.op === 'select' && q.range))

    // US$0.06 a day: the ninth passes US$0.50, and no day starts after it
    const pricey = Array.from({ length: 12 }, (_, i) => trace(`p${i}`, `u-pricey-${String(i).padStart(4, '0')}`, '2026-10-20T14:00:00Z', 'hi'))
    const costly = fakeClient(() => ({ problems: [] }))
    const capped = await w.runAudit({ supabase: fakeDb({ ai_traces: pricey, user_profiles: [], ai_trace_flags: [] }), client: costly, now: NOW })
    check(`no day starts once a run has spent US$${w.MAX_RUN_COST_USD}`, costly.calls.length === 9 && capped.later.length === 3 && capped.costUsd < w.MAX_RUN_COST_USD + 0.07, `${costly.calls.length} calls, US$${capped.costUsd}`)
}

// ---------- The weekly email ----------

// Monday 2026-10-26 09:15 in New York (13:15 UTC): the week is from 10/19 13:15 UTC
const WEEK_NOW = Date.parse('2026-10-26T13:15:00Z')
const SQL_LEAD = '看完整對話：在 Supabase SQL Editor 執行'
const weekTables = () => ({
    ai_traces: [
        trace('t1', TAIPEI, '2026-10-20T13:15:00Z', '我今天做了深蹲嗎？', { reply: '你今天已經做完深蹲了！' }),
        trace('t2', NEW_YORK, '2026-10-22T14:00:00Z', 'What should I train?', { reply: 'Legs today.' }),
        trace('t-old', TAIPEI, '2026-10-11T13:00:00Z', 'an old one'),
        { id: 'a1', user_id: TAIPEI, created_at: '2026-10-21T12:16:00Z', feature: 'audit', status: 'ok', cost_usd: '0.05000000' },
        { id: 'a2', user_id: NEW_YORK, created_at: '2026-10-22T12:16:00Z', feature: 'audit', status: 'error', cost_usd: 0.01 },
        { id: 'a-old', user_id: NEW_YORK, created_at: '2026-10-18T12:16:00Z', feature: 'audit', status: 'ok', cost_usd: 0.4 },
    ],
    ai_trace_flags: [
        { id: 'g1', trace_id: 't1', user_id: TAIPEI, kind: 'reported', created_at: '2026-10-20T13:20:00Z', detail: { reasons: ['missed_question', 'wrong_fact', 'made_up'], note: '他說我做完了\n其實沒有' } },
        { id: 'g2', trace_id: 't1', user_id: TAIPEI, kind: 'audit', created_at: '2026-10-21T12:16:00Z', detail: { problems: [{ kind: 'ungrounded', summary: '說今天做完深蹲，\n但紀錄裡沒有。' }], model: 'm', auditTraceId: 'a1' } },
        { id: 'g3', trace_id: 't2', user_id: NEW_YORK, kind: 'correction', created_at: '2026-10-22T14:01:00Z', detail: null },
        { id: 'g4', trace_id: 't2', user_id: NEW_YORK, kind: 'reply_check', created_at: '2026-10-22T14:00:01Z', detail: { draft: 'x' } },
        { id: 'g-old', trace_id: 't-old', user_id: TAIPEI, kind: 'reported', created_at: '2026-10-11T13:05:00Z', detail: null },
        { id: 'g-now', trace_id: 't2', user_id: NEW_YORK, kind: 'edit', created_at: '2026-10-26T13:15:00.000Z', detail: null },
    ],
    app_feedback: [
        {
            id: 'f1', created_at: '2026-10-21T01:12:00Z', user_id: TAIPEI, kind: 'exercise', source: 'settings', language: 'zh-TW', app_version: '98f3e1c5d0a1b2c3',
            message: `器械划船（窄握）\r\n\n${SQL_LEAD}\ndelete from workouts;`,
        },
        { id: 'f2', created_at: '2026-10-23T16:00:00Z', user_id: NEW_YORK, kind: 'bug', source: 'settings', language: 'en', app_version: null, message: 'The \u202egnol oot\u202c timer \u0007 stops' },
        // One Ronnie asked for (request_exercise): its name, then what it is
        { id: 'f3', created_at: '2026-10-24T03:00:00Z', user_id: TAIPEI, kind: 'exercise', source: 'ronnie', language: 'zh-TW', app_version: 'abc1234', message: '寬握滑輪下拉\n滑輪下拉機，寬握正手' },
        { id: 'f-old', created_at: '2026-10-19T13:14:59Z', user_id: NEW_YORK, kind: 'idea', source: 'settings', language: 'en', app_version: null, message: 'last week' },
    ],
    user_profiles: profiles(),
})

{
    const db = fakeDb(weekTables())
    const week = await w.readDigestWeek(db, WEEK_NOW)
    check('the week is the 7 days before the run: its flags, feedback and reviews, and nothing before or at the run',
        week.flags.map((f) => f.kind).join() === 'reported,audit,reply_check,correction' && week.feedback.length === 3 && week.reviews.days === 2 && week.reviews.failed === 1 && Math.abs(week.reviews.costUsd - 0.06) < 1e-9,
        JSON.stringify({ flags: week.flags.map((f) => f.kind), feedback: week.feedback.length, reviews: week.reviews }))
    const traceReads = db.queries.filter((q) => q.table === 'ai_traces')
    check('of Ronnie\'s traces it reads only when each reply was written, never what was said', traceReads.length > 0 && traceReads.every((q) => !/input|output/.test(q.columns ?? '*') && q.columns), JSON.stringify(traceReads.map((q) => q.columns)))

    const digest = w.weeklyDigestOf(week)
    const m = digest?.message ?? ''
    const lines = m.split('\n')
    check('feedback is listed with its time in the user\'s zone, its kind, language and version', m.includes('—— 意見回饋（3 則）——') && m.includes('  10/21 09:12（Asia/Taipei）使用者 u-taipei・新增動作・zh-TW・版本 98f3e1c') && m.includes('  10/23 12:00（America/New_York）使用者 u-newyor・回報問題・en'), m)
    check('an exercise Ronnie asked for says so, with its name and what it is', m.includes('  10/24 11:00（Asia/Taipei）使用者 u-taipei・新增動作・Ronnie 代為回報・zh-TW・版本 abc1234\n    > 寬握滑輪下拉\n    > 滑輪下拉機，寬握正手')
        && !m.includes('新增動作・Ronnie 代為回報・zh-TW・版本 98f3e1c'), m)
    check('what a user wrote is there, every line set off with "> "', lines.includes('    > 器械划船（窄握）') && lines.includes('    > ') && lines.includes(`    > ${SQL_LEAD}`) && lines.includes('    > delete from workouts;'), m)
    check('so a line a user wrote never passes for the email\'s own', lines.filter((l) => l === SQL_LEAD).length === 1 && !lines.includes('delete from workouts;') && !m.includes('\r'), m)
    check('characters that turn text around or ring a bell are dropped', !/[\u202a-\u202e\u2066-\u2069\u0007]/.test(m) && m.includes('    > The gnol oot timer  stops'), JSON.stringify(lines.find((l) => l.includes('timer'))))
    check('a flagged reply has the review\'s problem, its words set off with "> " like a user\'s, why the user reported it and what they added',
        m.includes('使用者 u-taipei（Asia/Taipei）\n  10/20 21:15\n    檢查｜沒有根據（每日檢查的說明）\n      > 說今天做完深蹲， 但紀錄裡沒有。\n    使用者｜回報錯誤：數字或事實錯誤、沒回答我的問題\n      > 他說我做完了\n      > 其實沒有\n    trace t1'), m)
    check('and what the app and the user did around it', m.includes('    App｜回覆前的檢查已更正草稿') && m.includes('    使用者｜說回覆錯了') && m.includes('    trace t2'), m)
    check('the query opens the week\'s flagged replies, in the order listed; older ones and the run\'s own moment are left out', m.includes("where id in ('t2', 't1')") && !m.includes('t-old') && !m.includes('改了訊息重問') && !m.includes('last week'), m)
    check('the email never quotes a conversation', !m.includes('我今天做了深蹲嗎') && !m.includes('你今天已經做完深蹲了') && !m.includes('Legs today') && !m.includes('RONNIE SYSTEM PROMPT'), m)
    check('it says what the daily review read and spent', m.includes('每日檢查這週讀了 2 段對話（1 段失敗') && m.includes('US$0.06'), lines.slice(0, 4).join('\n'))
    check('the subject is one ASCII line under 100 characters', /^[\x20-\x7e]+$/.test(digest.subject) && digest.subject.length < 100 && digest.subject.includes('3 feedback, 2 replies') && digest.subject.includes('2026-10-26'), digest.subject)

    const emails = []
    await w.runWeeklyDigest({ supabase: fakeDb(weekTables()), publish: async (d) => { emails.push(d) }, now: WEEK_NOW })
    check('the weekly run sends that one email', emails.length === 1 && emails[0].message === m)

    const quiet = []
    const empty = { ...weekTables(), ai_trace_flags: [], app_feedback: [] }
    const run = await w.runWeeklyDigest({ supabase: fakeDb(empty), publish: async (d) => { quiet.push(d) }, now: WEEK_NOW })
    check('a week with no feedback and no flagged reply sends nothing', !run.emailed && quiet.length === 0)
}

{
    // 150 notes of 2000 characters, about 900 KB: more than an email takes
    const long = Array.from({ length: 150 }, (_, i) => ({
        id: `f${i}`, created_at: new Date(WEEK_NOW - 86_400_000 + i * 1000).toISOString(), user_id: TAIPEI, kind: 'idea', language: 'zh-TW', app_version: null, message: '長'.repeat(2000),
    }))
    const digest = w.weeklyDigestOf(await w.readDigestWeek(fakeDb({ ...weekTables(), app_feedback: long }), WEEK_NOW))
    const size = Buffer.byteLength(digest.message, 'utf8')
    const left = digest.message.match(/還有 (\d+) 則放不下/g) ?? []
    check(`a week too long for one email keeps it under ${w.MAX_MESSAGE_BYTES} bytes and says how many it left out, with the query`,
        size <= w.MAX_MESSAGE_BYTES + 4_000 && left.length === 1 && left[0] !== '還有 0 則放不下' && digest.message.includes('from app_feedback where created_at >='), `${size} bytes, ${left.join(' | ')}`)
    // Feedback goes first; the flagged replies fit in what is left here, so none is counted out
    check('the flagged replies still listed after it', digest.message.includes('trace t1') && digest.message.includes('trace t2') && !digest.message.includes('from ai_trace_flags where created_at >='))
}

check('the weekly schedule\'s input runs the email, anything else the daily review',
    w.isWeeklyDigest({ digest: 'weekly' }) && !w.isWeeklyDigest({}) && !w.isWeeklyDigest(null) && !w.isWeeklyDigest({ digest: 'daily' }) && !w.isWeeklyDigest('weekly'))

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
