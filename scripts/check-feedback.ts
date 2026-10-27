// Free check of what users can send the owner (lib/feedback.ts): feedback from Settings, and the
// reasons and note with a report of one of Ronnie's replies. What the routes take and refuse, that
// every kind and reason the forms show has its words in both languages, and that the database
// takes the same kinds as the form. And the limit on how many a user sends (lib/insert-under-limit.ts),
// against a table in memory whose every step waits its turn: requests sent all at once keep no more
// than the limit, one after another they keep exactly the limit.
//   npm run check:feedback
import { readFileSync } from 'node:fs'
import { insertUnderLimit, type UnderLimit } from '../lib/insert-under-limit'
import { FEEDBACK_KINDS, MAX_FEEDBACK_CHARS, MAX_REPORT_NOTE_CHARS, parseFeedback, parseReport, REPORT_REASON_LABELS, REPORT_REASONS, userAgentOf } from '../lib/feedback'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const TRACE = 'aaaaaaaa-0000-4000-8000-000000000001'

// ---------- Feedback from Settings ----------
check('feedback is taken, trimmed, with its kind and language',
    same(parseFeedback({ kind: 'idea', message: '  希望課表可以用日曆看 ', language: 'zh-TW' }), { kind: 'idea', message: '希望課表可以用日曆看', language: 'zh-TW' }))
check('each kind the form shows is taken', FEEDBACK_KINDS.every((kind) => parseFeedback({ kind, message: 'x' })?.kind === kind))
check('a language other than Chinese is read as English', parseFeedback({ kind: 'bug', message: 'x', language: 'fr' })?.language === 'en')
for (const [what, body] of [
    ['an unknown kind', { kind: 'praise', message: 'x' }],
    ['no kind', { message: 'x' }],
    ['an empty message', { kind: 'bug', message: '   ' }],
    ['a message that is not text', { kind: 'bug', message: 42 }],
    [`more than ${MAX_FEEDBACK_CHARS} characters`, { kind: 'bug', message: 'a'.repeat(MAX_FEEDBACK_CHARS + 1) }],
    ['no body', null],
    ['a list', [{ kind: 'bug', message: 'x' }]],
] as [string, unknown][]) {
    check(`feedback with ${what} is refused`, parseFeedback(body) === null)
}
check(`${MAX_FEEDBACK_CHARS} characters are taken`, parseFeedback({ kind: 'bug', message: 'a'.repeat(MAX_FEEDBACK_CHARS) }) !== null)
check('a user agent is kept to 300 characters, and none is none', userAgentOf('a'.repeat(400))?.length === 300 && userAgentOf(null) === null)

// ---------- Reporting a reply ----------
check('a report with reasons and a note is taken; the reasons in the form\'s order, each once',
    same(parseReport({ traceId: TRACE, reasons: ['too_long', 'wrong_fact', 'too_long'], note: '  數字不對 ' }), { traceId: TRACE, reasons: ['wrong_fact', 'too_long'], note: '數字不對' }))
check('a report with neither still counts, as from a window opened before the form', same(parseReport({ traceId: TRACE }), { traceId: TRACE, reasons: [], note: null }))
check('an empty note is no note', parseReport({ traceId: TRACE, reasons: ['other'], note: '   ' })?.note === null)
for (const [what, body] of [
    ['a reason the form does not have', { traceId: TRACE, reasons: ['rude'] }],
    ['reasons that are not a list', { traceId: TRACE, reasons: 'wrong_fact' }],
    ['a note that is not text', { traceId: TRACE, note: 5 }],
    [`a note over ${MAX_REPORT_NOTE_CHARS} characters`, { traceId: TRACE, note: 'a'.repeat(MAX_REPORT_NOTE_CHARS + 1) }],
    ['no trace id', { reasons: ['other'] }],
    ['a trace id that is not one', { traceId: 'abc' }],
] as [string, unknown][]) {
    check(`a report with ${what} is refused`, parseReport(body) === null)
}

// ---------- The words ----------
{
    const missing = (['zh-TW', 'en'] as const).flatMap((lang) => REPORT_REASONS.filter((r) => !REPORT_REASON_LABELS[lang][r]?.trim()).map((r) => `${lang} ${r}`))
    check('every reason has its words in Chinese and English', missing.length === 0, missing.join(', '))
}
{
    const missing = (['zh-TW', 'en'] as const).flatMap((lang) => {
        const words = JSON.parse(readFileSync(`messages/${lang}.json`, 'utf8')).settings.feedback
        return FEEDBACK_KINDS.flatMap((k) => (['kinds', 'placeholders'] as const).filter((key) => !words[key]?.[k]?.trim()).map((key) => `${lang} ${key}.${k}`))
    })
    check('every kind has its name and its hint in Chinese and English', missing.length === 0, missing.join(', '))
}
{
    const sql = readFileSync('supabase/migrations/20261025120000_app_feedback.sql', 'utf8')
    const kinds = sql.match(/app_feedback_kind_check check \(kind in \(([^)]*)\)\)/)?.[1].split(',').map((k) => k.trim().replace(/'/g, ''))
    check('the database takes the same kinds as the form', same(kinds, FEEDBACK_KINDS), `${kinds} vs ${FEEDBACK_KINDS}`)
}

// ---------- The limit holds under a burst ----------
async function checkLimit() {
    // A table in memory. Each step yields first, so parallel requests interleave the way separate
    // requests to the database do: all may insert before any counts
    const step = () => new Promise<void>((resolve) => setTimeout(resolve, Math.random() * 3))
    const table = (fail: { count?: boolean; remove?: boolean } = {}) => {
        const rows = new Set<string>()
        let next = 0
        const deps = (max: number): UnderLimit => ({
            insert: async () => { await step(); const id = `r${next++}`; rows.add(id); return { data: { id }, error: null } },
            count: async () => { await step(); return fail.count ? { count: null, error: { message: 'count failed' } } : { count: rows.size, error: null } },
            remove: async (id) => { await step(); if (fail.remove) return { error: { message: 'remove failed' } }; rows.delete(id); return { error: null } },
            max,
        })
        return { rows, deps }
    }
    for (let run = 0; run < 20; run++) {
        const t = table()
        const answers = await Promise.all(Array.from({ length: 50 }, () => insertUnderLimit(t.deps(10))))
        const saved = answers.filter((a) => a === 'saved').length
        if (t.rows.size > 10 || saved !== t.rows.size) {
            check('50 requests sent at once keep no more than the limit of 10', false, `run ${run}: ${t.rows.size} rows kept, ${saved} said saved`)
            return
        }
    }
    check('50 requests sent at once keep no more than the limit of 10, in 20 runs, and each kept row was told saved', true)
    const one = table()
    const inTurn: string[] = []
    for (let i = 0; i < 12; i++) inTurn.push(JSON.stringify(await insertUnderLimit(one.deps(10))))
    check('one after another, the first 10 are saved and the next refused', inTurn.slice(0, 10).every((a) => a === '"saved"') && inTurn.slice(10).every((a) => a === '"limit"') && one.rows.size === 10, inTurn.join(' '))
    const uncounted = table({ count: true })
    check("a row that can't be counted is taken out again, and the failure said",
        JSON.stringify(await insertUnderLimit(uncounted.deps(10))) === '{"error":"count failed"}' && uncounted.rows.size === 0)
    const stuck = table({ remove: true })
    for (let i = 0; i < 10; i++) await insertUnderLimit(stuck.deps(10))
    check('when a row past the limit cannot be taken out, that is said, not "limit"', JSON.stringify(await insertUnderLimit(stuck.deps(10))) === '{"error":"remove failed"}')
}

checkLimit().then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall passed')
    process.exit(failed ? 1 : 0)
})
