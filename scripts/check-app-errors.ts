// Free check of how the app's own failures are kept (lib/app-errors.ts): the row a failure becomes,
// cut to what app_errors takes; saving it never throws; and every console.error the app server
// writes either goes through reportError or is an AI call's failure, which ai_traces records.
// The browser's failures too (lib/report-client-error.ts): lost signal is not reported, the
// route takes only a short, well-formed report, and a page sends each failure once, ten at most.
//   npm run check:app-errors
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appErrorRow, errorMessageOf, MAX_ERROR_MESSAGE_CHARS, MAX_SOURCE_CHARS, saveAppError, type AppErrorRow } from '../lib/app-errors'
import {
    CLIENT_SOURCE_PATTERN, isNetworkFailure, MAX_CLIENT_CONTEXT_VALUE_CHARS, MAX_CLIENT_MESSAGE_CHARS, MAX_REPORTS_PER_PAGE,
    NETWORK_FAILURES, parseClientErrorReport, reportClientError, responseError,
} from '../lib/report-client-error'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

// ---------- The message ----------
for (const [what, err, want] of [
    ['an Error', new Error('boom'), 'boom'],
    ['a Supabase error, with its code', { message: 'duplicate key value', code: '23505', details: 'x' }, 'duplicate key value (23505)'],
    ['a Supabase error without a code', { message: 'permission denied' }, 'permission denied'],
    ['a string', "Could not create today's workout", "Could not create today's workout"],
    ['an object with no message', { status: 500 }, '{"status":500}'],
    ['undefined', undefined, 'undefined'],
] as [string, unknown, string][]) {
    check(`the message of ${what}`, errorMessageOf(err) === want, JSON.stringify(errorMessageOf(err)))
}

// ---------- The row ----------
{
    const row = appErrorRow('error', 'save-routine', new Error('x'.repeat(5000)), { userId: 'u1', context: { step: 'save', skipped: undefined, n: 3 } })
    check(`a long message is cut to ${MAX_ERROR_MESSAGE_CHARS} characters`, row.message.length === MAX_ERROR_MESSAGE_CHARS)
    check('the level, the source and the user are kept', row.level === 'error' && row.source === 'save-routine' && row.user_id === 'u1')
    check('context keeps its facts and drops what is undefined', JSON.stringify(row.context) === '{"step":"save","n":3}', JSON.stringify(row.context))
    const long = appErrorRow('warning', 's'.repeat(300), '', { context: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v'.repeat(500)])) })
    check(`the source is cut to ${MAX_SOURCE_CHARS}, an empty message is named, context keeps 10 facts of 200 characters at most`,
        long.source.length === MAX_SOURCE_CHARS && long.message === '(no message)' && Object.keys(long.context ?? {}).length === 10
        && Object.values(long.context ?? {}).every((v) => String(v).length === 200), JSON.stringify({ source: long.source.length, message: long.message }))
    check('no context is null, not an empty object', appErrorRow('error', 'x', 'y').context === null)
}

// ---------- The save never throws ----------
async function checkSave() {
    const inserted: AppErrorRow[] = []
    const fake = (insert: (row: AppErrorRow) => Promise<{ error: { message: string } | null }>) => ({ from: (table: string) => ({ insert: (row: AppErrorRow) => (table === 'app_errors' ? insert(row) : Promise.reject(new Error(table))) }) }) as never
    const row = appErrorRow('error', 'check', 'it broke')
    const quiet = console.error
    console.error = () => {}
    const outcomes = await Promise.allSettled([
        saveAppError(fake(async (r) => { inserted.push(r); return { error: null } }), row),
        saveAppError(fake(async () => ({ error: { message: 'relation "app_errors" does not exist' } })), row),
        saveAppError(fake(async () => { throw new Error('network down') }), row),
        saveAppError(null, row),
    ])
    console.error = quiet
    check('a failure is saved to app_errors as its row', inserted.length === 1 && inserted[0] === row)
    check('a refused insert, a thrown one and no service key are logged, never thrown', outcomes.every((o) => o.status === 'fulfilled'), JSON.stringify(outcomes.map((o) => o.status)))
}

// ---------- Every server error is reported ----------
// An AI call's failure is traced in ai_traces, which its own alarms count; anything else the
// server logs as an error goes through reportError, so it reaches app_errors and alarms
const root = join(__dirname, '..', '..')
const AI_TRACED = ["'Ronnie error:'", "'Coach G reading failed:'", "'Coach G chat error:'"]
// The error code itself, and code bundled into the Lambda or the eval, which can't use Next's after()
const NOT_APP_SERVER = ['lib/app-errors.ts', 'lib/report-error.ts', 'lib/ai/trace.ts', 'lib/ai/trace-after.ts', 'lib/ronnie/data.ts', 'lib/report/']
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []
})
const unreported = ['app', 'lib'].flatMap((d) => files(join(root, d)))
    .map((p) => relative(root, p))
    .filter((p) => !NOT_APP_SERVER.some((x) => p.startsWith(x)))
    // Server code only: a client component reports with reportClientError, checked below
    .filter((p) => !/^['"]use client['"]/m.test(readFileSync(join(root, p), 'utf8')))
    .flatMap((p) => readFileSync(join(root, p), 'utf8').split('\n').flatMap((line, i) =>
        /console\.error\(/.test(line) && !AI_TRACED.some((m) => line.includes(m)) ? [`${p}:${i + 1}`] : []))
check('every console.error on the app server is an AI call (traced) or goes through reportError', !unreported.length, unreported.join(', '))

// ---------- The browser's failures: what counts as lost signal ----------
for (const m of NETWORK_FAILURES) {
    check(`"${m}" is a network failure, as thrown and as Supabase passes it on`,
        isNetworkFailure(new TypeError(m)) && isNetworkFailure({ message: `TypeError: ${m}`, details: '', hint: '', code: '' }) && isNetworkFailure(`${m}.`))
}
check('an aborted request is a network failure, by its name', isNetworkFailure(Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' })))
for (const real of [
    { message: 'new row violates row-level security policy for table "workout_sets"', code: '42501' },
    { message: 'duplicate key value violates unique constraint "routines_user_id_name_key"', code: '23505' },
    new TypeError("Cannot read properties of undefined (reading 'id')"),
    'Conversation request failed: 504',
    "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
]) {
    check(`"${errorMessageOf(real)}" is a real error, not lost signal`, !isNetworkFailure(real))
}

// ---------- What POST /api/errors accepts ----------
{
    const good = parseClientErrorReport({ source: 'client/today/save-set', message: 'x'.repeat(2000), context: { status: 504, step: 'v'.repeat(300), retried: false } })
    check(`a good report is taken, its message cut to ${MAX_CLIENT_MESSAGE_CHARS} and context text to ${MAX_CLIENT_CONTEXT_VALUE_CHARS}`,
        good?.source === 'client/today/save-set' && good.message.length === MAX_CLIENT_MESSAGE_CHARS
        && good.context?.status === 504 && String(good.context?.step).length === MAX_CLIENT_CONTEXT_VALUE_CHARS && good.context?.retried === false, JSON.stringify(good)?.slice(0, 200))
    check('a report without context is taken', parseClientErrorReport({ source: 'client/x', message: '' })?.context === undefined)
    for (const [what, body] of [
        ['no body', null],
        ['an array', [{ source: 'client/x', message: 'm' }]],
        ['a server source', { source: 'coach-g/save', message: 'm' }],
        ['a source in capitals', { source: 'client/Today', message: 'm' }],
        ['a source with a dot', { source: 'client/../x', message: 'm' }],
        ['a source too long', { source: `client/${'a'.repeat(62)}`, message: 'm' }],
        ['client/ alone', { source: 'client/', message: 'm' }],
        ['a message that is not text', { source: 'client/x', message: { text: 'm' } }],
        ['no message', { source: 'client/x' }],
        ['six facts of context', { source: 'client/x', message: 'm', context: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } }],
        ['a fact that is an object', { source: 'client/x', message: 'm', context: { form: { name: 'mine' } } }],
        ['a fact that is null', { source: 'client/x', message: 'm', context: { a: null } }],
        ['context that is a list', { source: 'client/x', message: 'm', context: ['a'] }],
    ] as [string, unknown][]) {
        check(`a report with ${what} is refused`, parseClientErrorReport(body) === null)
    }
}

// Every source the components report with is one the route takes
const clientSources = files(join(root, 'components')).flatMap((p) =>
    [...readFileSync(p, 'utf8').matchAll(/reportClientError\(\s*([^,]+),/g)].map((m) => ({ at: relative(root, p), source: m[1].trim() })))
const badSources = clientSources.filter(({ source }) => !/^'[^']*'$/.test(source) || !CLIENT_SOURCE_PATTERN.test(source.slice(1, -1)))
check(`every component reports with a written-out client/ source the route takes (${clientSources.length} calls)`,
    clientSources.length > 0 && !badSources.length, badSources.map((b) => `${b.at}: ${b.source}`).join(', '))

// And a failure the browser logs is reported too: reportClientError beside each console.error
const browserFiles = [...files(join(root, 'components')),
    ...['app', 'lib'].flatMap((d) => files(join(root, d))).filter((p) => /^['"]use client['"]/m.test(readFileSync(p, 'utf8')))]
const logOnly = browserFiles.flatMap((p) => {
    const lines = readFileSync(p, 'utf8').split('\n')
    return lines.flatMap((line, i) => /console\.error\(/.test(line) && !lines.slice(Math.max(0, i - 3), i + 4).some((l) => l.includes('reportClientError('))
        ? [`${relative(root, p)}:${i + 1}`] : [])
})
check('every console.error in the browser is also sent with reportClientError', !logOnly.length, logOnly.join(', '))

// ---------- What a page sends ----------
{
    const posted: { url: string; init: RequestInit }[] = []
    const nav = { onLine: true }
    let fetchThrows = false
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
    globalThis.fetch = ((url: string, init: RequestInit) => {
        if (fetchThrows) throw new Error('fetch is broken')
        posted.push({ url, init })
        // The route down: the caller never hears of it
        return Promise.reject(new TypeError('Failed to fetch'))
    }) as typeof fetch
    const sentMessages = () => posted.map((p) => JSON.parse(String(p.init.body)).message as string)

    nav.onLine = false
    reportClientError('client/check/offline', new Error('it broke offline'))
    nav.onLine = true
    reportClientError('client/check/network', { message: 'TypeError: Load failed', code: '' })
    reportClientError('client/check/signed-out', responseError('History request failed: 401', 401, { error: 'Unauthorized' }))
    reportClientError('client/check/too-long', responseError('Ronnie request failed: 413', 413, { error: 'Message too long' }))
    reportClientError('client/check/route-reported', responseError('Save request failed: 500', 500, { error: 'save_failed' }))
    check('offline, lost signal, a 4xx and a 5xx the route answered itself send nothing', posted.length === 0, JSON.stringify(sentMessages()))

    reportClientError('client/check/timeout', responseError('Ronnie request failed: 504', 504, null))
    reportClientError('client/check/bad-answer', responseError('Action failed: 200', 200, { text: 'no status' }))
    check('a 5xx the route never answered (a timeout) and a 2xx without what was asked for are sent', posted.length === 2, JSON.stringify(sentMessages()))
    const first = posted[0]
    check('a report is a keepalive POST to /api/errors that the route takes',
        first?.url === '/api/errors' && first.init.method === 'POST' && first.init.keepalive === true
        && parseClientErrorReport(JSON.parse(String(first.init.body)))?.source === 'client/check/timeout', JSON.stringify(first))

    const rls = { message: 'new row violates row-level security policy for table "workouts"', code: '42501' }
    reportClientError('client/check/save', new Error('Something went wrong. Please try again.', { cause: rls }), { step: 'insert' })
    const saved = JSON.parse(String(posted[2]?.init.body ?? '{}'))
    check('a friendly message thrown over a Supabase error is reported by its cause, with its context',
        saved.message === errorMessageOf(rls) && saved.context?.step === 'insert', JSON.stringify(saved))

    reportClientError('client/check/save', new Error('Something went wrong. Please try again.', { cause: rls }))
    reportClientError('client/check/save', rls)
    check('the same source and message is sent once a page load', posted.length === 3, JSON.stringify(sentMessages()))
    reportClientError('client/check/other', rls)
    check('the same message from another source is its own report', posted.length === 4)

    fetchThrows = true
    let threw = false
    try {
        reportClientError('client/check/broken-fetch', new Error('it broke'))
        reportClientError('client/check/odd', Object.create(null))
    } catch {
        threw = true
    }
    fetchThrows = false
    check('a fetch that throws, or an error that is no error, never throws', !threw)

    for (let i = 0; i < 30; i++) reportClientError(`client/check/many-${i}`, new Error(`failure ${i}`))
    // The two whose fetch threw were tries too
    check(`a page load sends ${MAX_REPORTS_PER_PAGE} reports at most, none twice`, new Set(posted.map((p) => p.init.body)).size === posted.length
        && posted.length + 2 === MAX_REPORTS_PER_PAGE, `${posted.length} sent, and two fetches threw`)
}

checkSave().then(() => {
    console.log(failed ? `\n${failed} check(s) failed` : '\nApp errors are kept whole enough to act on, never break what failed, and none is left only in the log; the browser sends each one once, and not for lost signal')
    process.exit(failed ? 1 : 0)
})
