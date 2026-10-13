#!/usr/bin/env node
// Consistency of a Ronnie eval run: pass^k counts a case only when every one of its reps passed
// (τ-bench, Yao et al. 2024). The mean pass rate hides a case that fails one run in five; pass^k
// doesn't. Free: it only reads results already on disk.
//   node evals/ronnie/pass-k.mjs <results.jsonl> [more.jsonl ...]
// Later files override earlier ones case by case, so a partial re-run can sit on a full run
// (for example v25's dev run with v26's re-run of the cases it touched).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = process.argv.slice(2)
if (!files.length) {
    console.error('usage: node evals/ronnie/pass-k.mjs <results.jsonl> [more.jsonl ...]')
    process.exit(2)
}

// The cases that change something: they expect a write, a confirmation, or a write tool. These are
// the ones a flaky run hurts most (a change made twice, or claimed and not made).
const WRITE_TOOLS = new Set(['add_exercise_today', 'remove_exercise_today', 'propose_routine_change'])
const cases = ['cases.json', 'cases-holdout.json', 'cases-knowledge.json'].flatMap((f) => JSON.parse(readFileSync(join(here, f), 'utf8')))
const writes = new Set(cases.filter((c) => c.expect.writes?.length || c.expect.confirm || (c.expect.tools_required ?? []).some((t) => WRITE_TOOLS.has(t))).map((c) => c.id))

const byCase = new Map()
for (const file of files) {
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const fresh = new Map()
    for (const r of rows) fresh.set(r.prompt_id, [...(fresh.get(r.prompt_id) ?? []), r.grade?.pass === 1])
    for (const [id, passes] of fresh) byCase.set(id, passes)
}

const summary = (ids) => {
    const runs = ids.flatMap((id) => byCase.get(id))
    const all = ids.filter((id) => byCase.get(id).every(Boolean))
    return { cases: ids.length, mean: runs.filter(Boolean).length / runs.length, passK: all.length / ids.length, runs: runs.length }
}
const pct = (x) => `${(x * 100).toFixed(0)}%`
const ids = [...byCase.keys()].sort()
const flaky = ids.filter((id) => !byCase.get(id).every(Boolean))

for (const [label, set] of [['all', ids], ['cases that change something', ids.filter((id) => writes.has(id))]]) {
    if (!set.length) continue
    const s = summary(set)
    const k = [...new Set(set.map((id) => byCase.get(id).length))].join('/')
    console.log(`${label}: ${s.cases} cases, ${s.runs} runs (k = ${k}): mean pass ${pct(s.mean)}, pass^k ${pct(s.passK)}`)
}
if (flaky.length) {
    console.log('\nNot passing every run:')
    for (const id of flaky) {
        const p = byCase.get(id)
        console.log(`  ${id}${writes.has(id) ? ' (changes something)' : ''}: ${p.filter(Boolean).length}/${p.length}`)
    }
}
