// Free check of what users can send the owner (lib/feedback.ts): feedback from Settings, and the
// reasons and note with a report of one of Ronnie's replies. What the routes take and refuse, and
// that every reason the form shows has its words in both languages.
//   npm run check:feedback
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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
