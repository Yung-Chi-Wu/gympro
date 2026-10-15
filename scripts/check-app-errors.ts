// Free check of how the app's own failures are kept (lib/app-errors.ts): the row a failure becomes,
// cut to what app_errors takes; saving it never throws; and every console.error the app server
// writes either goes through reportError or is an AI call's failure, which ai_traces records.
//   npm run check:app-errors
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appErrorRow, errorMessageOf, MAX_ERROR_MESSAGE_CHARS, MAX_SOURCE_CHARS, saveAppError, type AppErrorRow } from '../lib/app-errors'

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
    // Server code only: a client component's errors stay in the browser
    .filter((p) => !/^['"]use client['"]/m.test(readFileSync(join(root, p), 'utf8')))
    .flatMap((p) => readFileSync(join(root, p), 'utf8').split('\n').flatMap((line, i) =>
        /console\.error\(/.test(line) && !AI_TRACED.some((m) => line.includes(m)) ? [`${p}:${i + 1}`] : []))
check('every console.error on the app server is an AI call (traced) or goes through reportError', !unreported.length, unreported.join(', '))

checkSave().then(() => {
    console.log(failed ? `\n${failed} check(s) failed` : '\nApp errors are kept whole enough to act on, never break what failed, and none is left only in the log')
    process.exit(failed ? 1 : 0)
})
