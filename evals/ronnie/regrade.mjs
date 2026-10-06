#!/usr/bin/env node
// Re-scores a finished variant after a change to grade.mjs - no API calls.
// The conversation is rebuilt from traces/ (every write is a write-tool call in
// the fixture, so the writes are exact), the programmatic checks run again,
// and the judge verdicts already in results.jsonl are kept as they are.
//   node evals/ronnie/regrade.mjs .claude/hillclimb/ronnie baseline
// The original file is kept as results.before-regrade.jsonl.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { overallPass, programmaticGrade } from './grade.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { EXERCISES } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))
const [flow = '.claude/hillclimb/ronnie', variant = 'baseline'] = process.argv.slice(2)
const vdir = join(flow, variant)
const cases = new Map(['cases.json', 'cases-holdout.json'].flatMap((f) => JSON.parse(readFileSync(join(here, f), 'utf8'))).map((c) => [c.id, c]))
const WRITE_OPS = { add_exercise_today: 'add_today', remove_exercise_today: 'remove_today', remove_exercise_from_routine: 'delete_from_routines' }

function rebuild(trace) {
    const turns = []
    for (const m of trace) {
        if (m.role === 'user') turns.push({ user: m.content, toolCalls: [], writes: [], message: '' })
        else if (m.role === 'assistant') turns.at(-1).message = m.content
        else {
            const { input, result } = JSON.parse(m.content)
            turns.at(-1).toolCalls.push({ name: m.name, input, result })
            if (WRITE_OPS[m.name]) turns.at(-1).writes.push({ op: WRITE_OPS[m.name], exerciseId: input.exercise_id })
        }
    }
    return { turns, writes: turns.flatMap((t) => t.writes) }
}

const resultsPath = join(vdir, 'results.jsonl')
const backup = join(vdir, 'results.before-regrade.jsonl')
if (!existsSync(backup)) copyFileSync(resultsPath, backup)
const rows = readFileSync(backup, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

let changed = 0
const out = rows.map((r) => {
    const c = cases.get(r.prompt_id)
    const conv = rebuild(JSON.parse(readFileSync(join(vdir, 'traces', `${r.prompt_id}_rep${r.rep}.json`), 'utf8')))
    const { grade, explanation } = programmaticGrade(c, conv, EXERCISES)
    grade.judge_ok = r.grade.judge_ok
    if (r.explanation?.judge_ok) explanation.judge_ok = r.explanation.judge_ok
    grade.asks_first = r.grade.asks_first
    if (r.explanation?.asks_first) explanation.asks_first = r.explanation.asks_first
    const regraded = { pass: overallPass(grade), ...grade }
    if (JSON.stringify(regraded) !== JSON.stringify(r.grade)) {
        changed++
        const diff = Object.keys(regraded).filter((k) => regraded[k] !== r.grade[k]).map((k) => `${k} ${r.grade[k]}→${regraded[k]}`)
        console.log(`${r.prompt_id} rep${r.rep}: ${diff.join(', ')}`)
    }
    return { ...r, grade: regraded, explanation }
})
writeFileSync(resultsPath, out.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log(`${variant}: ${changed} of ${rows.length} rows changed`)
