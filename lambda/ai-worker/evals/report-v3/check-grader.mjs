#!/usr/bin/env node
// Free check of grade.mjs: for every scenario an ideal report text passes, and
// broken ones fail the check they break. No model calls.
//   node lambda/ai-worker/evals/report-v3/check-grader.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasNote, overallPass, programmaticGrade } from './grade.mjs'
import { inputsFor, SCENARIOS } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
execFileSync(join(here, '..', '..', 'node_modules/.bin/esbuild'), ['evals/report-v3/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/report-v3/dist/report.cjs', '--log-level=warning'], { cwd: join(here, '..', '..'), stdio: 'inherit' })
const { analyze, findingName, optionNames } = createRequire(import.meta.url)(join(here, 'dist', 'report.cjs'))

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log(`FAIL ${msg}`) } }

for (const c of SCENARIOS) {
    const { findings, facts } = analyze(inputsFor(c))
    const zh = c.language === 'zh-TW'
    // Ideal: one action per fired rule in priority order (a deload first), naming every item of it
    // and, for a low muscle, both exercises to choose between
    const names = Object.fromEntries(findings.map((f) => [f.id, findingName(f, c.language)]))
    const options = Object.fromEntries(findings.map((f) => [f.id, optionNames(f, c.language)]))
    const rules = [...new Set(findings.map((f) => f.rule))]
    const named = (r) => findings.filter((f) => f.rule === r).flatMap((f) => [names[f.id], ...options[f.id]]).filter(Boolean).join(zh ? '、' : ', ')
    const ideal = {
        narrative: {
            headline: zh ? '這週整體穩定，照下面的重點調整就好。' : 'A steady week; the points below are what to adjust.',
            items: rules.map((r) => ({ rule: r, action: `${named(r)}${zh ? '下週照這個方向調整。' : ' adjust this next week.'}` })),
        },
        findings, status: facts.status, brief: '', names, options,
    }
    const g = programmaticGrade(c, ideal).grade
    check(overallPass(g) === 1, `${c.id}: the ideal text should pass, got ${JSON.stringify(g)}`)
    const broken = (patch) => ({ ...ideal, narrative: { ...ideal.narrative, ...patch } })
    const item = ideal.narrative.items[0]

    check(programmaticGrade(c, broken({ items: [...ideal.narrative.items, { rule: 'made_up', action: 'x' }] })).grade.advice_valid === 0, `${c.id}: advice on a rule that didn't fire should fail`)
    if (findings.length) {
        check(programmaticGrade(c, broken({ items: [] })).grade.advice_valid === 0, `${c.id}: no advice when rules fired should fail`)
        check(programmaticGrade(c, broken({ items: [item, item] })).grade.advice_valid === 0, `${c.id}: the same rule twice should fail`)
        if (rules.length > 1) check(programmaticGrade(c, broken({ items: ideal.narrative.items.slice(1) })).grade.advice_valid === 0, `${c.id}: leaving out a fired rule should fail`)
        const withName = findings.find((f) => names[f.id])
        if (withName) {
            const dropName = ideal.narrative.items.map((i) => ({ ...i, action: i.action.replaceAll(names[withName.id], '') }))
            check(programmaticGrade(c, broken({ items: dropName })).grade.covers_all === 0, `${c.id}: an action that leaves out ${names[withName.id]} should fail`)
        }
        const withOption = findings.find((f) => options[f.id].length)
        if (withOption) {
            const option = options[withOption.id].at(-1)
            const dropOption = ideal.narrative.items.map((i) => ({ ...i, action: i.action.replaceAll(option, '') }))
            const g = programmaticGrade(c, broken({ items: dropOption })).grade
            check(hasNote(c) ? g.options_named === null : g.options_named === 0, `${c.id}: an action that leaves out ${option} should ${hasNote(c) ? 'be left to the judge (a note)' : 'fail'}`)
        }
    } else {
        check(programmaticGrade(c, broken({ items: [{ rule: 'low_volume', action: 'x' }] })).grade.advice_valid === 0, `${c.id}: advice when nothing fired should fail`)
    }
    if (rules.includes('deload') && rules.length > 1) {
        check(programmaticGrade(c, broken({ items: [...ideal.narrative.items].reverse() })).grade.deload_first === 0, `${c.id}: deload not first should fail`)
    }
    check(programmaticGrade(c, broken({ headline: zh ? '這週'.repeat(30) : 'word '.repeat(40) })).grade.headline_short === 0, `${c.id}: a long headline should fail`)
    check(programmaticGrade(c, broken({ headline: `**${ideal.narrative.headline}**` })).grade.plain_text === 0, `${c.id}: Markdown should fail`)
    const wrong = (c.weightUnit ?? 'kg') === 'lb' ? '臥推 102.5kg × 8' : 'bench 225 lb x 8'
    check(programmaticGrade(c, broken({ items: ideal.narrative.items.map((i) => ({ ...i, action: `${i.action} ${wrong}` })), headline: `${ideal.narrative.headline} ${wrong}` })).grade.unit_correct === 0, `${c.id}: a weight in the wrong unit should fail`)
    if (zh) {
        check(programmaticGrade(c, broken({ headline: '這週很穩定,繼續保持' })).grade.language_correct === 0, `${c.id}: half-width punctuation should fail`)
        check(programmaticGrade(c, broken({ headline: '这周训练很稳定' })).grade.language_correct === 0, `${c.id}: Simplified Chinese should fail`)
    } else {
        check(programmaticGrade(c, broken({ headline: '這週很穩定。', items: ideal.narrative.items.map((i) => ({ ...i, action: '照做。' })) })).grade.language_correct === 0, `${c.id}: Chinese in an English report should fail`)
    }
}
console.log(failures ? `\n${failures} grader check(s) failed` : `Grader behaves as expected (${SCENARIOS.length} ideal texts + negative controls)`)
process.exit(failures ? 1 : 0)
