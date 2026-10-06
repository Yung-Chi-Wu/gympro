#!/usr/bin/env node
// Offline sanity check for the programmatic grader - no API calls, no cost.
//   node lambda/ai-worker/evals/report/check-grader.mjs
// An oracle report must pass every case, an empty report must fail every case,
// and gaming strategies (flag everything, wrong language) must be caught.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { overallPass, programmaticGrade } from './grade.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))

const NAMES = {
    'zh-TW': { chest: '胸肌', back: '背部', legs: '腿部', shoulders: '肩膀', biceps: '二頭肌', triceps: '三頭肌', glutes: '臀部', core: '核心' },
    en: { chest: 'Chest', back: 'Back', legs: 'Legs', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', glutes: 'Glutes', core: 'Core' },
}
const PROSE = {
    'zh-TW': '這週整體訓練穩定，持續記錄重量與組數，下週維持目前的漸進節奏。',
    en: 'Training was steady this week. Keep logging weights and sets, and hold the current progression next week.',
}

function report(c, { language = c.expected.language, imbalanced = c.expected.imbalanced, status = c.expected.status, deload = c.expected.deload ?? false } = {}) {
    return {
        headline: PROSE[language],
        summary: PROSE[language],
        progressiveOverload: { status, notes: PROSE[language] },
        muscleImbalances: imbalanced.map((g) => ({ muscleGroup: NAMES[language][g], severity: 'moderate', observation: PROSE[language] })),
        deloadRecommended: deload,
        deloadReason: deload ? PROSE[language] : null,
        actionItems: [PROSE[language], PROSE[language]],
        contextSummary: PROSE[language],
    }
}

const strategies = {
    oracle: (c) => report(c),
    empty: () => ({}),
    flag_everything: (c) => report(c, { imbalanced: Object.keys(c.input.summary.targetPeriod.byMuscleGroup) }),
    wrong_language: (c) => report(c, { language: c.expected.language === 'en' ? 'zh-TW' : 'en' }),
}

let problems = 0
for (const [name, make] of Object.entries(strategies)) {
    const results = cases.map((c) => ({ c, ...programmaticGrade(c, make(c)) }))
    const passed = results.filter((r) => overallPass(r.grade) === 1).length
    console.log(`${name.padEnd(16)} passes ${passed}/${cases.length}`)
    if (name === 'oracle' && passed !== cases.length) {
        problems++
        for (const r of results.filter((r) => !overallPass(r.grade))) console.log('   oracle failed:', r.c.id, JSON.stringify(r.grade))
    }
    if (name === 'empty' && passed !== 0) { problems++; console.log('   empty output passed some cases') }
    if (name === 'wrong_language' && passed !== 0) { problems++; console.log('   wrong-language output passed some cases') }
    if (name === 'flag_everything') {
        const leaked = results.filter((r) => r.c.expected.balanced.length && overallPass(r.grade))
        if (leaked.length) { problems++; console.log('   flag-everything passed balanced cases:', leaked.map((r) => r.c.id).join(', ')) }
    }
}

// The two real reports the test athlete received on 2026-10-05, trimmed to graded fields
const real = [
    {
        caseId: 'first-report-progress-zh',
        out: {
            headline: '胸肌訓練量充足，但背部與腿部需要補強才能安全衝上臥推 80 公斤。',
            progressiveOverload: { status: 'insufficient_data', notes: '這是第一個記錄週期，無法判斷是否正在進步。' },
            muscleImbalances: [
                { muscleGroup: '背部', severity: 'moderate', observation: '背部僅完成 3 組。' },
                { muscleGroup: '腿部', severity: 'mild', observation: '腿部完成 4 組。' },
            ],
            deloadRecommended: false,
            actionItems: ['將背部訓練組數提升至至少 6 組。', '腿部訓練組數建議提升至 6 至 8 組。'],
        },
        expect: { status_correct: 0, imbalance_recall: 1, deload_correct: 1, language_correct: 1 },
    },
    {
        caseId: 'seed-week3-shoulder-note-zh',
        out: {
            headline: '臥推強度持續進步，但肩膀緊繃是本週最需要正視的警訊',
            progressiveOverload: { status: 'on_track', notes: '胸肌強度指數本週從 104 上升至 108。' },
            muscleImbalances: [
                { muscleGroup: '胸肌 vs. 背部', severity: 'moderate', observation: '推拉比例嚴重失衡。' },
                { muscleGroup: '肩膀', severity: 'mild', observation: '肩膀分配了 6 組。' },
                { muscleGroup: '腿部', severity: 'mild', observation: '腿部強度指數從 100 小幅下滑至 94。' },
            ],
            deloadRecommended: false,
            actionItems: ['暫時將肩膀訓練組數從 6 組減少至 3 至 4 組。', '將背部訓練組數提升至至少 5 至 6 組。'],
        },
        expect: { status_correct: 0, imbalance_recall: 1, language_correct: 1 },
    },
]
for (const r of real) {
    const c = cases.find((x) => x.id === r.caseId)
    const { grade, explanation } = programmaticGrade(c, r.out)
    const mismatches = Object.entries(r.expect).filter(([k, v]) => grade[k] !== v)
    console.log(`real ${r.caseId}: ${JSON.stringify(grade)}${mismatches.length ? '  <-- unexpected ' + JSON.stringify(mismatches) : ''}`)
    console.log(`   ${explanation.status_correct}; ${explanation.imbalance_recall}`)
    if (mismatches.length) problems++
}

console.log(problems ? `\n${problems} problem(s) found` : '\nGrader behaves as expected')
process.exit(problems ? 1 : 0)
