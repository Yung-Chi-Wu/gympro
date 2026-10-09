#!/usr/bin/env node
// Free check of the v3 report's code half: each scenario runs through analyze() and
// must produce exactly the expected findings, status, follow-ups, watched items,
// records and day notes, and the brief must carry the day notes as expected. No model calls.
//   node lambda/ai-worker/evals/report-v3/check-rules.mjs [--show id]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputsFor, SCENARIOS } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/report-v3/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/report-v3/dist/report.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const { analyze, buildPrompt } = createRequire(import.meta.url)(join(here, 'dist', 'report.cjs'))

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
    // The sets a low-volume finding says to add are the fewest that reach 10 a week
    const perWeek = (sets) => (sets * 7) / r.facts.period.days
    for (const f of r.findings.filter((x) => x.rule === 'low_volume')) {
        const { sets, addSets } = f.data
        if (!(perWeek(sets + addSets) >= 10 && perWeek(sets + addSets - 1) < 10)) problems.push(`${f.id}: addSets ${addSets} with ${sets} sets in ${r.facts.period.days} days`)
    }

    // Options: an exercise the user does that trains the muscle, and a staple they don't do yet
    const inputs = inputsFor(sc)
    const theirs = new Set([...inputs.sets.map((s) => s.exerciseId), ...(inputs.schedule ?? []).flatMap((d) => d.plan.map((p) => p.exerciseId))])
    for (const f of r.findings.filter((x) => x.rule === 'low_volume')) {
        const d = f.data
        if (d.addTo == null && d.newExercise == null) problems.push(`${f.id}: no option to offer`)
        if (d.addToId != null && !theirs.has(d.addToId)) problems.push(`${f.id}: addTo ${d.addTo} is not an exercise the user does`)
        if (d.newExerciseId != null && theirs.has(d.newExerciseId)) problems.push(`${f.id}: newExercise ${d.newExercise} is one the user already does`)
        const want = sc.expect.options?.[f.id]
        if (!want) continue
        const got = { ...d, addTo: d.addToId }
        for (const [k, v] of Object.entries(want)) if (got[k] !== v) problems.push(`${f.id}: ${k} ${JSON.stringify(got[k])}, expected ${JSON.stringify(v)}`)
    }

    // Day notes: every note comes through, on its own day, with that day's plan and whether it was trained
    const notes = Object.values(sc.dayNotes ?? {})
    if (JSON.stringify(r.dayNotes.map((d) => d.note)) !== JSON.stringify(notes)) problems.push(`day notes ${JSON.stringify(r.dayNotes.map((d) => d.note))}, expected ${JSON.stringify(notes)}`)
    if (sc.expect.dayNotes) {
        const days = r.dayNotes.map(({ date, routine, trained }) => ({ date, routine, trained }))
        if (JSON.stringify(days) !== JSON.stringify(sc.expect.dayNotes)) problems.push(`day notes lined up as ${JSON.stringify(days)}, expected ${JSON.stringify(sc.expect.dayNotes)}`)
    }
    const brief = buildPrompt({ ...r, note: sc.note ?? null, language: sc.language, weightUnit: sc.weightUnit ?? 'kg' })
    for (const line of sc.expect.brief ?? []) if (!brief.split('\n').includes(line)) problems.push(`the brief has no line ${JSON.stringify(line)}`)
    if (!notes.length && /notes on single days/.test(brief)) problems.push('the brief lists day notes, but there are none')

    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${sc.id}${problems.map((p) => `\n       ${p}`).join('')}`)
    if (show === sc.id) console.log(JSON.stringify({ ...r, facts: { ...r.facts, sessions: { ...r.facts.sessions, days: r.facts.sessions.days.length } } }, null, 1))
}
// Without a training cycle there is no plan to line a note up with: the brief says only whether the day was trained
{
    const sc = SCENARIOS.find((x) => x.id === 'bench-pain-day-note-en')
    const r = analyze(inputsFor({ ...sc, cycle: false }))
    const brief = buildPrompt({ ...r, note: null, language: sc.language, weightUnit: 'kg' })
    const want = `- 2026-10-01 (trained): ${JSON.stringify(sc.dayNotes[3])}`
    const ok = brief.split('\n').includes(want)
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} day notes without a cycle${ok ? '' : `\n       the brief has no line ${JSON.stringify(want)}`}`)
}
console.log(failed ? `\n${failed} scenario(s) failed` : `\nAll ${SCENARIOS.length} scenarios behave as expected`)
process.exit(failed ? 1 : 0)
