#!/usr/bin/env node
// Free check of the v3 report's code half: each scenario runs through analyze() and
// must produce exactly the expected findings, status, follow-ups, watched items and
// records. No model calls.
//   node lambda/ai-worker/evals/report-v3/check-rules.mjs [--show id]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputsFor, SCENARIOS } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/report-v3/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/report-v3/dist/analyze.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const { analyze } = createRequire(import.meta.url)(join(here, 'dist', 'analyze.cjs'))

const show = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1] : null
let failed = 0
for (const sc of SCENARIOS) {
    const r = analyze(inputsFor(sc))
    const problems = []
    const ids = r.findings.map((f) => f.id)
    if (JSON.stringify(ids) !== JSON.stringify(sc.expect.findings)) problems.push(`findings ${JSON.stringify(ids)}, expected ${JSON.stringify(sc.expect.findings)}`)
    if (r.facts.status !== sc.expect.status) problems.push(`status ${r.facts.status}, expected ${sc.expect.status}`)
    const watched = r.watching.map((w) => `${w.rule}:${w.subject ?? '-'}`)
    for (const w of sc.expect.watching ?? []) if (!watched.includes(w)) problems.push(`not watching ${w} (watching ${JSON.stringify(watched)})`)
    for (const [id, status] of Object.entries(sc.expect.followUps ?? {})) {
        const f = r.followUps.find((x) => x.id === id)
        if (f?.status !== status) problems.push(`follow-up ${id}: ${f?.status ?? 'missing'}, expected ${status}`)
    }
    const records = r.facts.records.map((x) => x.exerciseId)
    for (const id of sc.expect.records ?? []) if (!records.includes(id)) problems.push(`no record for ${id} (records ${JSON.stringify(records)})`)
    if (sc.expect.records && !sc.expect.records.length && records.length) problems.push(`records ${JSON.stringify(records)}, expected none`)

    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${sc.id}${problems.map((p) => `\n       ${p}`).join('')}`)
    if (show === sc.id) console.log(JSON.stringify({ ...r, facts: { ...r.facts, sessions: { ...r.facts.sessions, days: r.facts.sessions.days.length } } }, null, 1))
}
console.log(failed ? `\n${failed} scenario(s) failed` : `\nAll ${SCENARIOS.length} scenarios behave as expected`)
process.exit(failed ? 1 : 0)
