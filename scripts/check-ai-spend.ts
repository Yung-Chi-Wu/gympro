// Free check of the AI spend limits (lib/ai/spend-limits.ts):
// - the limits read from the environment, with their defaults, and the off switch;
// - asking for a slot, against a fake database: a refusal says why and until when, a busy user
//   waits a while for their last request, a slot is let go once, and when the limits themselves
//   fail the request goes ahead and the failure is reported;
// - a request's cost is saved even when what was said can't be (U+0000, a lone surrogate): the
//   routes refuse such text first, and a trace the database refuses for it is saved without it;
// - in the app's code, only lib/ai/model-client.ts makes a model client or reads the API key, so
//   every model call has asked first, and every feature the app traces is one the limits count.
// The code is read as syntax (the TypeScript parser), not text; a known bad file is checked first
// to show the scan works.
//   npm run check:ai-spend
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'
import ts from 'typescript'
import { askForSlot, LIMITED_FEATURES, NEW_ACCOUNT_DAYS, SLOT_SECONDS, spendLimitsFrom, type SlotDeps } from '../lib/ai/spend-limits'
import { recordTrace, type Trace } from '../lib/ai/trace'
import { isStorableText } from '../lib/text-limits'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

// ---------- The limits ----------
{
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    check('with nothing set: US$0.50 a user, US$1 for new accounts together and US$5 for everyone over 24 hours, on',
        same(spendLimitsFrom({}), { userUsd: 0.5, newUsd: 1, allUsd: 5, off: false }), JSON.stringify(spendLimitsFrom({})))
    check('set in the environment, they are used',
        same(spendLimitsFrom({ AI_USER_DAILY_USD: '0.2', AI_NEW_DAILY_USD: '2', AI_ALL_DAILY_USD: ' 3 ' }), { userUsd: 0.2, newUsd: 2, allUsd: 3, off: false }))
    check('0 is a limit (nothing goes through), not a missing one', spendLimitsFrom({ AI_USER_DAILY_USD: '0' }).userUsd === 0)
    check('a value that is no amount (empty, words, negative) falls back to the default',
        same(spendLimitsFrom({ AI_USER_DAILY_USD: '', AI_NEW_DAILY_USD: 'one', AI_ALL_DAILY_USD: 'ten' }), { userUsd: 0.5, newUsd: 1, allUsd: 5, off: false })
        && spendLimitsFrom({ AI_USER_DAILY_USD: '-1' }).userUsd === 0.5)
    check('AI_LIMITS=off turns them off; anything else leaves them on',
        spendLimitsFrom({ AI_LIMITS: 'off' }).off && !spendLimitsFrom({ AI_LIMITS: 'no' }).off)
}

// ---------- Asking for a slot ----------
type Answer = { data: unknown; error: unknown } | Error
function fakeDatabase(answers: Answer[]) {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const failures: string[] = []
    let allReached = 0
    let clock = 0
    const sleeps: number[] = []
    const deps = (over: Partial<SlotDeps> = {}): SlotDeps => ({
        rpc: async (fn, args) => {
            calls.push({ fn, args })
            const answer = fn === 'end_ai_request' ? { data: null, error: null } : answers.shift() ?? { data: { ok: true }, error: null }
            if (answer instanceof Error) throw answer
            return answer
        },
        limits: { userUsd: 0.5, newUsd: 0.8, allUsd: 1, off: false },
        failed: (err, step) => failures.push(`${step}: ${err instanceof Error ? err.message : JSON.stringify(err)}`),
        allReached: () => { allReached++ },
        sleep: async (ms) => { sleeps.push(ms); clock += ms },
        now: () => clock,
        ...over,
    })
    return { calls, failures, sleeps, deps, allReachedCount: () => allReached }
}
const ok = { data: { ok: true }, error: null }
const refusedAs = (reason: string, resets_at: string | null = null) => ({ data: { ok: false, reason, resets_at }, error: null })

async function checkSlots() {
    {
        const db = fakeDatabase([ok])
        const asked = await askForSlot('u1', db.deps())
        const begin = db.calls[0]
        check('a slot is asked for this user, the limited features, the limits (the new-account one too) and the slot time',
            asked.ok && begin?.fn === 'begin_ai_request' && begin.args.p_user_id === 'u1'
            && JSON.stringify(begin.args.p_features) === JSON.stringify(LIMITED_FEATURES)
            && begin.args.p_user_usd === 0.5 && begin.args.p_all_usd === 1 && begin.args.p_slot_seconds === SLOT_SECONDS
            && begin.args.p_new_usd === 0.8 && begin.args.p_new_days === NEW_ACCOUNT_DAYS
            && typeof begin.args.p_request_id === 'string', JSON.stringify(begin))
        if (asked.ok) {
            await Promise.all([asked.release(), asked.release()])
            const ends = db.calls.filter((c) => c.fn === 'end_ai_request')
            check('release lets that same request go, once, however often it is called',
                ends.length === 1 && ends[0].args.p_request_id === begin.args.p_request_id && ends[0].args.p_user_id === 'u1', JSON.stringify(ends))
        }
        check('nothing failed', db.failures.length === 0, db.failures.join('; '))
    }
    {
        const db = fakeDatabase([refusedAs('user', '2026-10-25T15:20:00Z')])
        const asked = await askForSlot('u1', db.deps())
        check("at the user's limit: refused, with when it resets, and asked once",
            !asked.ok && asked.refused.reason === 'user' && asked.refused.resetsAt === '2026-10-25T15:20:00Z' && db.calls.length === 1, JSON.stringify(asked))
    }
    {
        const db = fakeDatabase([refusedAs('all', '2026-10-25T09:00:00Z')])
        const asked = await askForSlot('u1', db.deps())
        check("at the all-users limit: refused, and it's reported",
            !asked.ok && asked.refused.reason === 'all' && db.allReachedCount() === 1, JSON.stringify(asked))
    }
    {
        const db = fakeDatabase([refusedAs('busy'), refusedAs('busy'), ok])
        const asked = await askForSlot('u1', db.deps())
        check('while the last request is still running, it waits and asks again, then goes ahead',
            asked.ok && db.calls.length === 3 && db.sleeps.length === 2, `${db.calls.length} asks, ${db.sleeps.length} waits`)
        const ids = new Set(db.calls.map((c) => c.args.p_request_id))
        check('every ask is for the same request', ids.size === 1)
    }
    {
        const db = fakeDatabase(Array.from({ length: 100 }, () => refusedAs('busy')))
        const asked = await askForSlot('u1', db.deps())
        const waited = db.sleeps.reduce((a, b) => a + b, 0)
        check('if it stays busy, it gives up after about 10 seconds: refused as busy',
            !asked.ok && asked.refused.reason === 'busy' && waited <= 10_000 && waited >= 9_000, `${waited} ms over ${db.calls.length} asks`)
    }
    for (const [what, answer] of [
        ['the database answers an error', { data: null, error: { message: 'connection refused' } }],
        ['the request throws', new Error('fetch failed')],
        ['the function is missing', { data: null, error: { message: 'Could not find the function public.begin_ai_request', code: 'PGRST202' } }],
        ['the answer is not one it knows', { data: { ok: 'maybe' }, error: null }],
        ['the reason is not one it knows', refusedAs('tired')],
    ] as [string, Answer][]) {
        const db = fakeDatabase([answer])
        const asked = await askForSlot('u1', db.deps())
        check(`when ${what}, the request goes ahead and the failure is reported`,
            asked.ok && db.failures.length === 1 && db.failures[0].startsWith('begin: '), `${JSON.stringify(asked)} ${db.failures.join('; ')}`)
    }
    {
        const db = fakeDatabase([])
        const asked = await askForSlot('u1', db.deps({ rpc: null }))
        check('without the service role key, the request goes ahead and it is reported',
            asked.ok && db.failures.length === 1 && db.failures[0].includes('SUPABASE_SERVICE_ROLE_KEY'), db.failures.join('; '))
    }
    {
        const db = fakeDatabase([refusedAs('user')])
        const asked = await askForSlot('u1', db.deps({ limits: { userUsd: 0.5, newUsd: 0.8, allUsd: 1, off: true } }))
        check('switched off: it goes ahead without asking', asked.ok && db.calls.length === 0)
    }
    {
        const db = fakeDatabase([ok])
        const asked = await askForSlot('u1', db.deps({
            rpc: async (fn) => (fn === 'begin_ai_request' ? ok : { data: null, error: { message: 'timeout' } }),
        }))
        let threw = false
        if (asked.ok) await asked.release().catch(() => { threw = true })
        check('a slot that fails to let go is reported as such, and release still does not throw',
            asked.ok && !threw && db.failures.length === 1 && db.failures[0] === 'end: {"message":"timeout"}', db.failures.join('; '))
    }
}

// ---------- The app's code ----------
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : walk(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
})
const parse = (file: string, text: string) =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const MODEL_CLIENT = normalize('lib/ai/model-client.ts')
const MODEL_API_HOST = 'api.anthropic.com'
const hostOf = (text: string) => {
    try {
        return new URL(text).hostname
    } catch {
        return null
    }
}
const files = [...['app', 'components', 'lib'].flatMap(walk), 'proxy.ts', 'instrumentation.ts'].map(normalize)

function problemsIn(file: string, sf: ts.SourceFile): string[] {
    // What the file imports from the SDK, as values
    const sdk = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith('@anthropic-ai/')) continue
        if (st.importClause?.isTypeOnly) continue
        if (st.importClause?.name) sdk.add(st.importClause.name.text)
        const bindings = st.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) if (!el.isTypeOnly) sdk.add(el.name.text)
        if (bindings && ts.isNamespaceImport(bindings)) sdk.add(bindings.name.text)
    }
    const problems: string[] = []
    const at = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
    const visit = (node: ts.Node) => {
        if (file !== MODEL_CLIENT) {
            if (ts.isNewExpression(node)) {
                const made = node.expression
                const root = ts.isPropertyAccessExpression(made) ? made.expression : made
                if (ts.isIdentifier(root) && sdk.has(root.text)) problems.push(`${at(node)} makes a model client: take one with takeAiSlot (lib/ai/model-client.ts)`)
            }
            const envName = ts.isPropertyAccessExpression(node) && node.expression.getText(sf) === 'process.env' ? node.name.text
                : ts.isElementAccessExpression(node) && node.expression.getText(sf) === 'process.env' && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text
                : null
            if (envName === 'ANTHROPIC_API_KEY') problems.push(`${at(node)} reads the model API key: only lib/ai/model-client.ts may`)
            // A URL in a string, or at the start of a template, whose host is the API's
            if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && hostOf(node.text) === MODEL_API_HOST) {
                problems.push(`${at(node)} calls the model API by its address`)
            }
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'traceAfterResponse') {
            const trace = node.arguments[0]
            const feature = trace && ts.isObjectLiteralExpression(trace)
                ? trace.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'feature')?.initializer
                : undefined
            const name = feature && ts.isStringLiteral(feature) ? feature.text : null
            if (!name) problems.push(`${at(node)} traces a feature this check can't read`)
            else if (!(LIMITED_FEATURES as string[]).includes(name)) problems.push(`${at(node)} traces ${name}, which the spend limits don't count: add it to LIMITED_FEATURES`)
        }
        ts.forEachChild(node, visit)
    }
    visit(sf)
    return problems
}

// A file that gets each rule wrong once, and right once, to show the scan sees them
{
    const fake = normalize('app/api/check-ai-spend-fake/route.ts')
    const sf = parse(fake, [
        "import Anthropic from '@anthropic-ai/sdk'",
        "import * as sdk from '@anthropic-ai/sdk'",
        "import type { Message } from '@anthropic-ai/sdk/resources'",
        "import { takeAiSlot } from '@/lib/ai/model-client'",
        'export async function POST() {',
        '    const a = new Anthropic({',
        "        apiKey: process.env['ANTHROPIC_API_KEY'],",
        '    })',
        '    const b = new sdk.Anthropic()',
        "    await fetch(`https://api.anthropic.com/v1/${'messages'}`, { headers: { referer: 'https://example.com/?api.anthropic.com' } })",
        "    const { slot } = await takeAiSlot('u')",
        "    traceAfterResponse({ userId: 'u', feature: 'ronnie' }, slot!)",
        "    traceAfterResponse({ userId: 'u', feature: 'report' }, slot!)",
        '    const m: Message | null = null',
        '    return [a, b, m, process.env.NEXT_PUBLIC_SUPABASE_URL]',
        '}',
    ].join('\n'))
    // "line first-two-words" of each problem
    const found = problemsIn(fake, sf).map((p) => p.slice(fake.length + 1).split(' ').slice(0, 3).join(' '))
    const want = ['6 makes a', '7 reads the', '9 makes a', '10 calls the', '13 traces report,']
    check('the scan finds a client made, the key read, the API called by address and a feature not counted, and nothing else',
        JSON.stringify(found) === JSON.stringify(want), JSON.stringify(found))
}

const sources = new Map(files.map((file) => [file, parse(file, readFileSync(file, 'utf8'))]))
const problems = files.flatMap((file) => problemsIn(file, sources.get(file)!))
check('only lib/ai/model-client.ts makes model clients or reads the key, and every traced feature is counted', problems.length === 0, problems.join('\n       '))
{
    const routes = files.filter((file) => /traceAfterResponse\(/.test(sources.get(file)!.text) && file.startsWith('app'))
    check('the scan sees the routes that call the model (three or more)', routes.length >= 3, routes.join(', '))
    const unasked = routes.filter((file) => !/takeAiSlot\(/.test(sources.get(file)!.text))
    check('each of them asks for a slot', unasked.length === 0, unasked.join(', '))
}

// ---------- A request's cost is always saved ----------
{
    const kept = ['練背 lat pulldown', '💪 emoji pairs', '']
    const refused = ['a\u0000b', 'a\ud800b', 'a\udc00b', '\udc00\ud800', 'end\ud83d', '\udc00start', '💪\udcaa']
    check('text the database keeps passes: Chinese, English, emoji (surrogate pairs), empty', kept.every(isStorableText))
    check('text it refuses is caught: U+0000, a lone high or low surrogate, a pair the wrong way round, an extra low after a pair',
        refused.every((t) => !isStorableText(t)), refused.filter(isStorableText).map((t) => JSON.stringify(t)).join(', '))
}

async function checkTraces() {
    const usage = [{ input_tokens: 1000, output_tokens: 100 }] as Trace['usage']
    const trace: Trace = { userId: 'u1', feature: 'ronnie', model: 'claude-sonnet-5-5', status: 'ok', latencyMs: 10, usage, input: { message: 'a\u0000b' }, output: { reply: 'ok' } }
    // A fake ai_traces: each insert takes the next answer, and the rows it was given are kept
    const fake = (answers: ({ message: string; code: string } | null)[]) => {
        const rows: Record<string, unknown>[] = []
        const supabase = { from: () => ({ insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: answers[rows.length - 1] ?? null } } }) }
        return { rows, supabase: supabase as unknown as Parameters<typeof recordTrace>[0] }
    }
    const refusedText = { message: 'unsupported Unicode escape sequence', code: '22P05' }

    const saved = fake([null])
    check('a trace that saves is written once and says nothing', (await recordTrace(saved.supabase, trace)) === null && saved.rows.length === 1)

    const retried = fake([refusedText, null])
    const said = await recordTrace(retried.supabase, trace)
    const [first, second] = retried.rows
    check('a trace refused for its text is saved again without input and output, with the same cost',
        retried.rows.length === 2 && JSON.stringify(second.input) === JSON.stringify({ unsaved: refusedText.message }) && JSON.stringify(second.output) === JSON.stringify({ unsaved: refusedText.message })
            && typeof first.cost_usd === 'number' && first.cost_usd > 0 && second.cost_usd === first.cost_usd && second.user_id === 'u1',
        JSON.stringify(retried.rows.map((r) => ({ input: r.input, cost: r.cost_usd }))))
    check('and says so, so it is still reported', !!said && said.startsWith('Saved without input and output'), String(said))

    const twice = fake([refusedText, { message: 'still refused', code: '22P05' }])
    const both = await recordTrace(twice.supabase, trace)
    check('when the second insert fails too, both errors are said', twice.rows.length === 2 && !!both?.includes('still refused'), String(both))

    // Another error (the network, a conflict) may mean the row is there: a second insert could count it twice
    const other = fake([{ message: 'fetch failed', code: '' }])
    check('any other error is not retried', (await recordTrace(other.supabase, trace)) === 'fetch failed' && other.rows.length === 1)
}

Promise.all([checkSlots(), checkTraces()]).then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall passed')
    process.exit(failed ? 1 : 0)
})
