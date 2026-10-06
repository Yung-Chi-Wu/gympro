#!/usr/bin/env node
// Builds the weekly-report eval cases: cases.json (read by the runner) and
// cases.md (for human review). Each case is the exact input generateRecommendation
// receives in production, with planted signals and expected labels.
//
//   node lambda/ai-worker/evals/report/build-cases.mjs
//
// Derived numbers (totals, volume split, BMI, ...) are computed the same way
// the worker computes them, so cases stay internally consistent. The expected
// status comes from the agreed rule in expectedStatus(); imbalance and deload
// expectations are hand-written per case.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Typical tonnage per working set (kg), so volume split looks realistic
const PER_SET_KG = { chest: 480, back: 500, legs: 400, shoulders: 280, biceps: 144, triceps: 300, glutes: 450, core: 60 }

const BALANCED = { chest: 6, back: 6, legs: 6, shoulders: 4, biceps: 3, triceps: 3 }

// Agreed labelling rule (2026-10-05). Change is measured against the previous
// report's index, or against the 100 baseline when there is no previous report.
//   regressing        any group dropped 3+ points
//   on_track          any group gained 3+ points and none regressed
//   stalling          every group moved less than 3 points
//   insufficient_data no strength data at all
export function expectedStatus(strengthIndex) {
    const deltas = Object.values(strengthIndex).map((s) => s.currentIndex - (s.previousIndex ?? 100))
    if (deltas.length === 0) return 'insufficient_data'
    if (deltas.some((d) => d <= -3)) return 'regressing'
    if (deltas.some((d) => d >= 3)) return 'on_track'
    return 'stalling'
}

const round1 = (n) => Math.round(n * 10) / 10

// `tonnage` overrides the typical per-set load, for cases that mirror real data
function buildSummary({ sets, index, profile, routine, tonnage }) {
    const byMuscleGroup = {}
    for (const [mg, n] of Object.entries(sets)) byMuscleGroup[mg] = { sets: n, tonnageKg: tonnage?.[mg] ?? n * PER_SET_KG[mg] }
    const totalSets = Object.values(byMuscleGroup).reduce((a, b) => a + b.sets, 0)
    const totalTonnageKg = Object.values(byMuscleGroup).reduce((a, b) => a + b.tonnageKg, 0)

    const volumeSplit = {}
    for (const [mg, d] of Object.entries(byMuscleGroup)) volumeSplit[mg] = Math.round((d.tonnageKg / totalTonnageKg) * 1000) / 10

    const strengthIndex = {}
    for (const [mg, [currentIndex, previousIndex]] of Object.entries(index)) strengthIndex[mg] = { currentIndex, previousIndex }

    const { heightCm = 175, weightKg = 72, ageYears = 28, sex = 'male' } = profile ?? {}
    return {
        userContext: {
            heightCm,
            latestWeightKg: weightKg,
            weightRecordedAt: weightKg == null ? null : '2026-09-28T12:00:00+00:00',
            ageYears,
            sex,
            bmi: heightCm && weightKg ? round1(weightKg / (heightCm / 100) ** 2) : null,
        },
        targetPeriod: {
            periodStart: '2026-09-28',
            periodEnd: '2026-10-04',
            totalSets,
            totalTonnageKg,
            tonnagePerBodyweightKg: weightKg ? round1(totalTonnageKg / weightKg) : null,
            byMuscleGroup,
        },
        volumeSplit,
        strengthIndex,
        routineAdherence: routine ?? { followedRoutines: [], missedRoutines: [] },
    }
}

const PREV_ZH = '胸肌與三頭在進步，但背部和腿部訓練量偏少，建議增加划船與腿部組數。'
const PREV_EN = 'Steady progress on the main lifts; keep the current progression and watch recovery.'

// expect.imbalanced: groups a correct report must flag (any severity)
// expect.balanced:   groups it must NOT flag as moderate/severe
// expect.deload:     true / false, or null when either answer is defensible
const SPECS = [
    {
        id: 'first-report-progress-zh', tags: ['first_report', 'zh'], language: 'zh-TW',
        goal: '增肌，三個月內臥推做到 80 公斤', note: null, prev: null,
        // The test athlete's real week-2 numbers (seed/test_athlete_planted_signals.sql)
        profile: { weightKg: 72.3 },
        sets: { chest: 8, shoulders: 6, triceps: 3, back: 3, biceps: 3, legs: 4 },
        tonnage: { chest: 4000, shoulders: 1680, triceps: 990, back: 1500, biceps: 432, legs: 1600 },
        index: { chest: [104, null], triceps: [110, null], shoulders: [100, null], back: [100, null], biceps: [100, null], legs: [100, null] },
        // Legs (4 sets) is left ungraded: about as low as back and biceps, so flagging it is optional (decided 2026-10-05)
        expect: { imbalanced: ['back'], balanced: ['triceps'], deload: false },
        why: 'Regression case from 2026-10-05: no previous report, yet chest/triceps are already above the 100 baseline. Must not be called insufficient_data or "first recorded period".',
    },
    {
        id: 'seed-week3-shoulder-note-zh', tags: ['user_note', 'zh'], language: 'zh-TW',
        goal: '增肌，三個月內臥推做到 80 公斤', note: '這週肩膀有點緊，推的動作有點吃力', prev: PREV_ZH,
        // The test athlete's real week-3 numbers, so check-judge.mjs can calibrate on its real report
        profile: { weightKg: 72.6 },
        sets: { chest: 8, shoulders: 6, triceps: 3, back: 3, biceps: 3, legs: 4 },
        tonnage: { chest: 4160, shoulders: 1680, triceps: 1080, back: 1500, biceps: 432, legs: 1500 },
        index: { chest: [108, 104], triceps: [120, 110], legs: [94, 100], shoulders: [100, 100], back: [100, 100], biceps: [100, 100] },
        // Same volume as first-report-progress-zh, so legs is ungraded here too
        expect: { imbalanced: ['back'], balanced: ['triceps'], deload: null },
        why: 'The planted-signal test athlete (week 3). Squat regressed 6 points, so the rule says regressing even though bench improved. Should respond to the shoulder note.',
    },
    {
        id: 'balanced-all-progress-en', tags: ['progress', 'en'], language: 'en',
        goal: 'Build muscle and get stronger overall', note: null, prev: PREV_EN,
        sets: BALANCED,
        index: { chest: [112, 106], back: [110, 104], legs: [115, 108], shoulders: [108, 104], biceps: [106, 102], triceps: [109, 104] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: false },
        why: 'Clean positive control: everything up 4-7 points on a balanced split. No imbalance, no deload.',
    },
    {
        id: 'balanced-all-progress-zh', tags: ['progress', 'zh'], language: 'zh-TW',
        goal: '維持體能、全身均衡發展', note: null, prev: PREV_ZH,
        sets: { chest: 5, back: 6, legs: 7, glutes: 3, shoulders: 4, core: 3 },
        index: { chest: [107, 103], back: [109, 105], legs: [111, 106], glutes: [106, 102], shoulders: [104, 100], core: [103, 100] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'Positive control in Chinese, with glutes and core in the mix.',
    },
    {
        id: 'balanced-stalling-en', tags: ['stalling', 'en'], language: 'en',
        goal: 'Increase strength', note: null, prev: PREV_EN,
        sets: BALANCED,
        index: { chest: [105, 104], back: [103, 103], legs: [107, 108], shoulders: [102, 101], biceps: [101, 101], triceps: [104, 104] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: null },
        why: 'Every group within ±1 of last period: stalling, balanced.',
    },
    {
        id: 'stalling-busy-note-zh', tags: ['user_note', 'zh'], language: 'zh-TW',
        goal: '增肌', note: '最近工作很忙，一週只能練兩次，先求維持', prev: PREV_ZH,
        sets: { chest: 3, back: 3, legs: 3, shoulders: 2, biceps: 2, triceps: 2 },
        index: { chest: [106, 106], back: [104, 105], legs: [108, 107], shoulders: [103, 103], biceps: [102, 102], triceps: [105, 105] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'Low volume by choice; holding steady is the right outcome. A deload makes no sense here, and the note should be acknowledged.',
    },
    {
        id: 'threshold-up-plus2-en', tags: ['threshold', 'en'], language: 'en',
        goal: 'Build muscle', note: null, prev: PREV_EN,
        sets: BALANCED,
        index: { chest: [106, 104], back: [104, 103], legs: [107, 105], shoulders: [103, 103], biceps: [102, 102], triceps: [104, 104] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: null },
        why: 'Gains of at most 2 points are noise under the rule: stalling, not on_track.',
    },
    {
        id: 'threshold-down-minus2-zh', tags: ['threshold', 'zh'], language: 'zh-TW',
        goal: '增強力量', note: null, prev: PREV_ZH,
        sets: BALANCED,
        index: { chest: [104, 105], back: [103, 103], legs: [106, 108], shoulders: [102, 102], biceps: [101, 101], triceps: [103, 103] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: false },
        why: 'A 2-point dip is noise: stalling, not regressing.',
    },
    {
        id: 'goal-lift-up-back-down-en', tags: ['regression', 'en'], language: 'en',
        goal: 'Bench press 100 kg', note: null, prev: PREV_EN,
        sets: { chest: 9, triceps: 4, shoulders: 4, back: 4, biceps: 2, legs: 4 },
        index: { chest: [112, 106], triceps: [108, 105], back: [96, 101], shoulders: [104, 104], biceps: [100, 100], legs: [102, 102] },
        expect: { imbalanced: ['back'], balanced: ['legs'], deload: false },
        why: 'The goal lift is improving, but back dropped 5 points: regressing by the rule. Tests that goal progress does not hide a regression.',
    },
    {
        id: 'multi-regression-fatigue-zh', tags: ['deload', 'zh'], language: 'zh-TW',
        goal: '增肌', note: '最近睡不好、一直覺得很累，膝蓋有點痠', prev: '各肌群穩定進步，維持目前的漸進節奏。',
        sets: BALANCED,
        index: { chest: [98, 104], back: [95, 100], legs: [93, 100], shoulders: [97, 101], biceps: [100, 100], triceps: [101, 102] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: true },
        why: 'Four groups down 4-7 points plus poor sleep, fatigue and knee pain: the clear deload case.',
    },
    {
        id: 'overreaching-high-volume-en', tags: ['deload', 'en'], language: 'en',
        goal: 'Build muscle', note: 'My joints ache, I feel run down and my sessions keep getting worse', prev: PREV_EN,
        sets: { chest: 12, back: 12, legs: 12, shoulders: 8, biceps: 6, triceps: 6 },
        index: { chest: [99, 105], back: [98, 104], legs: [97, 104], shoulders: [99, 103], biceps: [100, 101], triceps: [100, 102] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: true },
        why: 'Roughly double the usual volume, five groups down 4-7 points, and the user reports aching joints and fatigue: the second clear deload case.',
    },
    {
        id: 'multi-regression-no-note-en', tags: ['regression', 'en'], language: 'en',
        goal: 'Build muscle', note: null, prev: PREV_EN,
        sets: BALANCED,
        index: { chest: [101, 106], back: [100, 104], legs: [102, 108], shoulders: [103, 103], biceps: [102, 102], triceps: [104, 104] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: null },
        why: 'Three groups down 4-6 points with no explanation: regressing. Deload is defensible either way.',
    },
    {
        id: 'leg-neglect-en', tags: ['imbalance', 'en'], language: 'en',
        goal: 'Build muscle', note: null, prev: PREV_EN,
        sets: { chest: 6, back: 6, shoulders: 4, biceps: 3, triceps: 3, legs: 1 },
        index: { chest: [108, 104], back: [107, 104], shoulders: [103, 102], biceps: [101, 101], triceps: [104, 103], legs: [100, 100] },
        expect: { imbalanced: ['legs'], balanced: ['chest', 'back'], deload: false },
        why: 'One leg set all week (under 5% of volume) while upper body progresses.',
    },
    {
        id: 'push-pull-imbalance-zh', tags: ['imbalance', 'zh'], language: 'zh-TW',
        goal: '增肌', note: null, prev: PREV_ZH,
        sets: { chest: 10, shoulders: 6, triceps: 4, back: 3, biceps: 2, legs: 5 },
        index: { chest: [105, 105], shoulders: [103, 102], triceps: [104, 104], back: [101, 101], biceps: [100, 100], legs: [102, 103] },
        expect: { imbalanced: ['back'], balanced: ['legs'], deload: null },
        why: '20 push sets vs 5 pull sets, nothing moving: stalling with a push/pull imbalance.',
    },
    {
        id: 'pull-heavy-en', tags: ['imbalance', 'en'], language: 'en',
        goal: 'Build a bigger back', note: null, prev: PREV_EN,
        sets: { back: 12, biceps: 6, chest: 2, shoulders: 2, legs: 6 },
        index: { back: [110, 106], biceps: [104, 104], chest: [100, 100], shoulders: [101, 101], legs: [103, 103] },
        expect: { imbalanced: ['chest'], balanced: ['legs'], deload: false },
        why: 'Mirror image of the usual imbalance: chest is the neglected group.',
    },
    {
        id: 'balanced-mixed-control-zh', tags: ['progress', 'zh'], language: 'zh-TW',
        goal: '增肌', note: null, prev: PREV_ZH,
        sets: BALANCED,
        index: { chest: [107, 104], back: [105, 103], legs: [104, 105], shoulders: [102, 102], biceps: [101, 101], triceps: [103, 103] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs', 'shoulders'], deload: false },
        why: 'Negative control for imbalance: balanced split, chest +3, small wobbles elsewhere. Nothing should be flagged.',
    },
    {
        id: 'missing-body-metrics-en', tags: ['missing_data', 'en'], language: 'en',
        goal: null, note: null, prev: PREV_EN,
        profile: { heightCm: null, weightKg: null, ageYears: null, sex: null },
        sets: BALANCED,
        index: { chest: [108, 104], back: [104, 103], legs: [105, 105], shoulders: [102, 102], biceps: [101, 101], triceps: [103, 103] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'No height, weight, age, sex or goal. Must not invent a bodyweight, BMI or age.',
    },
    {
        id: 'fat-loss-goal-zh', tags: ['goal', 'zh'], language: 'zh-TW',
        goal: '減脂 5 公斤，保留肌肉', note: null, prev: PREV_ZH,
        profile: { heightCm: 172, weightKg: 82, ageYears: 35, sex: 'male' },
        sets: BALANCED,
        index: { chest: [103, 103], back: [102, 102], legs: [104, 105], shoulders: [101, 101], biceps: [100, 100], triceps: [102, 102] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'Strength holding steady during a cut is a good outcome; advice should fit the fat-loss goal.',
    },
    {
        id: 'missed-routines-en', tags: ['adherence', 'en'], language: 'en',
        goal: 'Build muscle', note: null, prev: PREV_EN,
        sets: { chest: 3, back: 3, legs: 4, shoulders: 2, biceps: 2, triceps: 2 },
        routine: { followedRoutines: ['Upper A', 'Lower A'], missedRoutines: ['Upper B', 'Lower B'] },
        index: { chest: [104, 104], back: [103, 103], legs: [105, 106], shoulders: [102, 102], biceps: [101, 101], triceps: [103, 103] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'Half the planned sessions missed; stalling, and consistency is the obvious lever.',
    },
    {
        id: 'older-female-progress-en', tags: ['progress', 'en'], language: 'en',
        goal: 'Stay strong and healthy', note: null, prev: PREV_EN,
        profile: { heightCm: 163, weightKg: 68, ageYears: 46, sex: 'female' },
        sets: { chest: 4, back: 5, legs: 6, glutes: 3, shoulders: 3, core: 3 },
        index: { chest: [106, 102], back: [107, 103], legs: [110, 105], glutes: [108, 104], shoulders: [103, 102], core: [102, 101] },
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'Different profile (46, female, BMI 25.6) with solid progress; advice should be calibrated, not generic.',
    },
    {
        id: 'borderline-11-sets-zh', tags: ['low_volume', 'zh'], language: 'zh-TW',
        goal: '增肌', note: null, prev: PREV_ZH,
        sets: { chest: 4, back: 4, legs: 3 },
        index: { chest: [105, 100], back: [100, 100], legs: [100, 100] },
        expect: { imbalanced: [], balanced: ['chest', 'back'], deload: false },
        why: 'Just over the 10-set minimum, three groups only; chest +5 so on_track.',
    },
    {
        id: 'empty-strength-index-en', tags: ['missing_data', 'en'], language: 'en',
        goal: 'Build muscle', note: null, prev: PREV_EN,
        sets: { chest: 4, back: 4, legs: 4 },
        index: {},
        expect: { imbalanced: [], balanced: ['chest', 'back', 'legs'], deload: false },
        why: 'Sets were logged but there is no strength index: the one case where insufficient_data is correct.',
    },
]

const cases = SPECS.map((s) => {
    const summary = buildSummary(s)
    return {
        id: s.id,
        tags: s.tags,
        prompt: s.why,
        input: { summary, previousContext: s.prev, trainingGoal: s.goal, userNote: s.note, language: s.language },
        expected: { status: expectedStatus(summary.strengthIndex), ...s.expect, language: s.language },
        meta: { why: s.why },
    }
})

writeFileSync(join(here, 'cases.json'), JSON.stringify(cases, null, 2) + '\n')

// ---------- cases.md for review ----------
const fmtIndex = (si) =>
    Object.entries(si)
        .map(([mg, { currentIndex: c, previousIndex: p }]) => `${mg} ${p ?? 100}→${c}`)
        .join(', ') || '(none)'
const lines = [
    '# Weekly report eval cases',
    '',
    `${cases.length} cases. Generated by \`build-cases.mjs\`; edit the specs there, not this file.`,
    '',
    'Expected status follows the agreed rule: any group down 3+ points → `regressing`; else any group up 3+ → `on_track`; else `stalling`; no strength data → `insufficient_data`. Change is measured against the previous report, or the 100 baseline when there is none.',
    '',
    '| id | tags | expected status | must flag | must not flag | deload |',
    '|---|---|---|---|---|---|',
    ...cases.map(
        (c) =>
            `| ${c.id} | ${c.tags.join(', ')} | ${c.expected.status} | ${c.expected.imbalanced.join(', ') || '—'} | ${c.expected.balanced.join(', ') || '—'} | ${c.expected.deload ?? 'either'} |`
    ),
    '',
]
for (const c of cases) {
    const { summary } = c.input
    lines.push(
        `## ${c.id}`,
        '',
        c.meta.why,
        '',
        `- Strength index: ${fmtIndex(summary.strengthIndex)}`,
        `- Sets: ${Object.entries(summary.targetPeriod.byMuscleGroup).map(([mg, d]) => `${mg} ${d.sets}`).join(', ')} (total ${summary.targetPeriod.totalSets})`,
        `- Goal: ${c.input.trainingGoal ?? '(none)'} · Note: ${c.input.userNote ?? '(none)'} · Language: ${c.input.language}`,
        '',
        '<details><summary>Full input</summary>',
        '',
        '````json',
        JSON.stringify(c.input, null, 2),
        '````',
        '',
        '</details>',
        ''
    )
}
writeFileSync(join(here, 'cases.md'), lines.join('\n'))

console.log(`Wrote ${cases.length} cases to cases.json and cases.md`)
const tally = cases.reduce((m, c) => ((m[c.expected.status] = (m[c.expected.status] ?? 0) + 1), m), {})
console.log('Expected status:', tally)
