// Free check that every write counts in the browser's data version (lib/data-version.ts), so a page
// never shows data from before the user's own last write ("read your writes"):
// - the browser's Supabase client counts what writes and nothing else, a failed request too, and
//   it is the only one the browser makes;
// - serverWrite counts a write once it's done, failed or not;
// - in the app's code every call of a server action, and every request to the app's API that isn't
//   a read, sits inside serverWrite (the few API routes that write nothing a page shows are named
//   below, with why);
// - every signed-in page renders <ReadYourWrites />.
// The code is read as syntax (the TypeScript parser), not text, so a call split over lines or
// wrapped in a ternary is still seen; a known bad file is checked first to show the scan works.
//   npm run check:data-writes
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import ts from 'typescript'
import { dataChanged, dataVersion, isDataWrite, serverWrite, writeTrackingFetch } from '../lib/data-version'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

// Requests to the app's API that write nothing a page shows, so they needn't count
const NOT_PAGE_DATA: Record<string, string> = {
    '/api/errors': 'an error report, kept in app_errors',
    '/api/ai/coach/feedback': "a flag on one of Ronnie's answers, kept in ai_trace_flags",
    '/api/ai/routine-chat': "Coach G's chat, which writes only its trace",
    '/api/ai/generate-routine': "Coach G's draft, which writes only its trace (saving it is /api/ai/save-routine)",
}

// ---------- What the browser's client counts ----------
const SB = 'https://ref.supabase.co'
for (const [what, input, init, counts] of [
    ['a read of a table', `${SB}/rest/v1/workouts?select=id`, undefined, false],
    ['a count (HEAD)', `${SB}/rest/v1/workouts?select=*`, { method: 'HEAD' }, false],
    ['an insert', `${SB}/rest/v1/workout_sets`, { method: 'POST' }, true],
    ['an update', `${SB}/rest/v1/routines?id=eq.1`, { method: 'PATCH' }, true],
    ['a delete', `${SB}/rest/v1/workout_sets?id=eq.1`, { method: 'DELETE' }, true],
    ['an rpc', `${SB}/rest/v1/rpc/start_today_workout`, { method: 'POST' }, true],
    ['a method in lower case', `${SB}/rest/v1/day_notes`, { method: 'post' }, true],
    ['a write as a Request', new Request(`${SB}/rest/v1/day_notes`, { method: 'POST' }), undefined, true],
    ['a token refresh', `${SB}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' }, false],
] as [string, RequestInfo, RequestInit | undefined, boolean][]) {
    check(`${what} ${counts ? 'counts' : "doesn't count"} as a write`, isDataWrite(input, init) === counts)
}

async function checkCounting() {
    const answered = async () => new Response('[]')
    const unreachable = async (): Promise<Response> => { throw new TypeError('Failed to fetch') }
    const moves = async (what: string, by: number, run: () => Promise<unknown>) => {
        const before = dataVersion()
        await run().catch(() => null)
        check(what, dataVersion() === before + by, `moved by ${dataVersion() - before}`)
    }
    await moves("the client's read leaves the version as it was", 0, () => writeTrackingFetch(answered)(`${SB}/rest/v1/workouts?select=id`))
    await moves("the client's write moves it up one", 1, () => writeTrackingFetch(answered)(`${SB}/rest/v1/workout_sets`, { method: 'POST' }))
    await moves('a write whose request failed counts too: it may have reached the database', 1,
        () => writeTrackingFetch(unreachable)(`${SB}/rest/v1/workout_sets`, { method: 'POST' }))
    await moves('dataChanged counts one', 1, async () => dataChanged())
    const before = dataVersion()
    const value = await serverWrite(async () => 'saved')
    check("serverWrite returns the write's result and counts it", value === 'saved' && dataVersion() === before + 1)
    const failure = await serverWrite(async () => { throw new Error('boom') }).catch((e: unknown) => e)
    check('serverWrite passes a failure on and still counts it', failure instanceof Error && failure.message === 'boom' && dataVersion() === before + 2)
}

// ---------- The app's code ----------
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : walk(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
})
const parse = (file: string, text: string) =>
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const files = ['app', 'components', 'lib'].flatMap(walk)
const sources = new Map(files.map((file) => [file, parse(file, readFileSync(file, 'utf8'))]))

const directive = (sf: ts.SourceFile) => {
    const first = sf.statements[0]
    return first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) ? first.expression.text : null
}
const serverModules = new Set(files.filter((file) => directive(sources.get(file)!) === 'use server'))

// '@/x' and './x' to the file they name
function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith('@/') ? spec.slice(2) : spec.startsWith('.') ? join(dirname(from), spec) : null
    if (base === null) return null
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const file = normalize(base + ext)
        if (sources.has(file)) return file
    }
    return null
}

// The path of a request to the app's API, without its query; null for any other request
function apiPathOf(arg: ts.Expression | undefined): string | null {
    const text = !arg ? null
        : ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text
        : ts.isTemplateExpression(arg) ? arg.head.text
        : null
    return text?.startsWith('/api/') ? text.split('?')[0] : null
}

// The method a fetch sends: GET unless its options say otherwise; '?' when they say it some way
// this can't read, which counts as a write
function methodOf(arg: ts.Expression | undefined): string {
    if (!arg) return 'GET'
    if (!ts.isObjectLiteralExpression(arg)) return '?'
    for (const prop of arg.properties) {
        if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'method') return '?'
        if (!ts.isPropertyAssignment(prop) || prop.name.getText() !== 'method') continue
        return ts.isStringLiteral(prop.initializer) ? prop.initializer.text.toUpperCase() : '?'
    }
    return 'GET'
}

const insideServerWrite = (node: ts.Node) => {
    for (let p = node.parent; p; p = p.parent) if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'serverWrite') return true
    return false
}

function problemsIn(file: string, sf: ts.SourceFile): string[] {
    if (serverModules.has(file)) return []
    const actions = new Set<string>()
    const namespaces = new Set<string>()
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue
        const target = resolveImport(file, st.moduleSpecifier.text)
        if (!target || !serverModules.has(target)) continue
        if (st.importClause?.name) actions.add(st.importClause.name.text)
        const bindings = st.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) if (!el.isTypeOnly) actions.add(el.name.text)
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
    const problems: string[] = []
    const at = (node: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression
            const action = ts.isIdentifier(callee) && actions.has(callee.text) ? callee.text
                : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) ? callee.getText(sf)
                : null
            if (action && !insideServerWrite(node)) problems.push(`${at(node)} calls the server action ${action} outside serverWrite`)
            if (ts.isIdentifier(callee) && callee.text === 'fetch') {
                const path = apiPathOf(node.arguments[0])
                const method = methodOf(node.arguments[1])
                if (path && method !== 'GET' && method !== 'HEAD' && !(path in NOT_PAGE_DATA) && !insideServerWrite(node)) {
                    problems.push(`${at(node)} sends ${method} ${path} outside serverWrite`)
                }
            }
            if (ts.isIdentifier(callee) && callee.text === 'createBrowserClient' && file !== normalize('lib/supabase/client.ts')) {
                problems.push(`${at(node)} makes its own browser Supabase client: its writes wouldn't count; use lib/supabase/client.ts`)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(sf)
    return problems
}

// A file that gets each rule wrong once, and right once, to show the scan sees them
{
    const fake = normalize('components/CheckDataWritesFake.tsx')
    const sf = parse(fake, [
        "import { saveDayNote } from '@/app/(app)/dashboard/period-actions'",
        "import * as actions from '@/app/(app)/dashboard/period-actions'",
        "import { serverWrite } from '@/lib/data-version'",
        'export async function f(open: boolean) {',
        "    await (open ? saveDayNote('a') : null)",
        "    await serverWrite(() => saveDayNote('b'))",
        "    await actions.savePeriodNote('c')",
        "    await fetch(`/api/ai/coach/actions?x=${1}`, {",
        "        method: 'POST',",
        '    })',
        "    await serverWrite(() => fetch('/api/ai/coach', { method: 'DELETE' }))",
        "    await fetch('/api/errors', { method: 'POST' })",
        "    await fetch('/api/history/workouts')",
        '    createBrowserClient()',
        '}',
    ].join('\n'))
    // "line first-two-words" of each problem
    const found = problemsIn(fake, sf).map((p) => p.slice(fake.length + 1).split(' ').slice(0, 3).join(' '))
    const want = ['5 calls the', '7 calls the', '8 sends POST', '14 makes its']
    check('the scan finds an action and a write request outside serverWrite, and a second browser client, and nothing else',
        JSON.stringify(found) === JSON.stringify(want), JSON.stringify(found))
}

check('the scan sees the server actions (four or more files)', serverModules.size >= 4, [...serverModules].join(', '))
const problems = files.flatMap((file) => problemsIn(file, sources.get(file)!))
check('every server action call and every write request to the API counts in the data version', problems.length === 0, problems.join('\n       '))

{
    const client = sources.get(normalize('lib/supabase/client.ts'))
    check("the browser's Supabase client is given writeTrackingFetch", !!client && /writeTrackingFetch\(/.test(client.text))
}

// ---------- The pages ----------
const pages = files.filter((file) => file.startsWith(normalize('app/(app)/')) && file.endsWith('page.tsx'))
check('the scan sees the signed-in pages (four or more)', pages.length >= 4, pages.join(', '))
for (const page of pages) {
    let renders = false
    const visit = (node: ts.Node) => {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === 'ReadYourWrites') renders = true
        ts.forEachChild(node, visit)
    }
    visit(sources.get(page)!)
    check(`${page} renders <ReadYourWrites />`, renders)
}

checkCounting().then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall passed')
    process.exit(failed ? 1 : 0)
})
