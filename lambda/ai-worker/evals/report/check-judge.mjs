#!/usr/bin/env node
// Calibration check for the Opus judge - 4 paid judge calls (~$0.15).
//   AWS_PROFILE=gympro-terraform AWS_REGION=us-east-1 node lambda/ai-worker/evals/report/check-judge.mjs
// Three negative controls must fail every criterion; the real 2026-09-28 report
// is the calibration case with verdicts a human already agreed on.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judge, judgeGrade } from './judge.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
process.env.ANTHROPIC_API_KEY_PARAM ??= '/gympro/anthropic-api-key'
const { getClaudeClient } = require(join(here, 'dist', 'claude.cjs'))

const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))
const c = cases.find((x) => x.id === 'seed-week3-shoulder-note-zh')

const realReport = {
    headline: '臥推強度持續進步，但肩膀緊繃是本週最需要正視的警訊',
    summary: '這週總訓練組數為 27 組。胸肌強度指數從 104 上升到 108，三頭肌更從 110 躍升至 120。你自己提到肩膀這週有點緊、推的動作感覺吃力，這與肩膀訓練量偏高（6 組，佔 16.2%）卻強度指數原地踏步（維持 100）的現象互相呼應。背部和二頭肌的強度指數也停在 100，腿部從 100 小幅下滑至 94。',
    progressiveOverload: { status: 'on_track', notes: '胸肌強度指數從 104 上升至 108，三頭肌從 110 提升至 120。背部、二頭肌、肩膀均無進展，腿部從 100 回落至 94。' },
    muscleImbalances: [
        { muscleGroup: '胸肌 vs. 背部', severity: 'moderate', observation: '胸肌訓練量佔比 40.2%（8 組），背部僅 14.5%（3 組），推拉比例失衡，可能加劇肩膀緊繃。' },
        { muscleGroup: '肩膀', severity: 'mild', observation: '肩膀 6 組（16.2%），強度指數停滯在 100 且本人反映緊繃，需要短期減量並加強活動度。' },
        { muscleGroup: '腿部', severity: 'mild', observation: '腿部強度指數從 100 下滑至 94，訓練量僅 4 組（14.5%）。' },
    ],
    deloadRecommended: false,
    deloadReason: null,
    actionItems: [
        '肩膀緊繃期間，暫時將肩膀訓練組數從 6 組減少至 3 至 4 組，並在訓練前加入 5 至 10 分鐘的肩關節熱身與活動度動作。',
        '將背部訓練組數從 3 組提升至至少 5 至 6 組，優先選擇划船類動作。',
        '可嘗試在臥推主組上小幅加重（例如增加 2.5 公斤）或增加一組工作組。',
        '腿部強度指數下滑至 94，建議將腿部訓練增加至 5 至 6 組，增加下肢訓練刺激也有助於提升全身睪固酮分泌，間接支持增肌目標。',
    ],
}

const checks = [
    { name: 'empty report', report: '', expect: { grounded_numbers: 0, sound_advice: 0, note_addressed: 0 } },
    { name: '"I don\'t know"', report: '我不知道。', expect: { grounded_numbers: 0, sound_advice: 0, note_addressed: 0 } },
    {
        name: 'confident answer to the wrong user',
        report: {
            headline: '你的馬拉松配速大幅進步，本週跑量 85 公里！',
            summary: '你這週跑了 85 公里，平均配速每公里 4 分 50 秒，體重降到 65 公斤。',
            progressiveOverload: { status: 'on_track', notes: '長跑距離從 18 公里進步到 25 公里。' },
            muscleImbalances: [],
            deloadRecommended: false,
            deloadReason: null,
            actionItems: ['下週把長跑拉到 30 公里。', '每天補充 200 克碳水。'],
        },
        expect: { grounded_numbers: 0, sound_advice: 0, note_addressed: 0 },
    },
    { name: 'real 2026-09-28 report', report: realReport, expect: { grounded_numbers: 1, sound_advice: 0, note_addressed: 1 } },
]

const client = await getClaudeClient()
let mismatches = 0
// --real-only re-runs just the calibration case after the negatives have passed once
const selected = process.argv.includes("--real-only") ? checks.filter((x) => x.name.startsWith("real")) : checks
for (const chk of selected) {
    const j = await judge(client, c.input, chk.report)
    const { grade, explanation } = judgeGrade(c.input, j.verdicts)
    const bad = Object.entries(chk.expect).filter(([k, v]) => grade[k] !== v)
    mismatches += bad.length
    console.log(`${bad.length ? 'MISMATCH' : 'ok      '} ${chk.name}: ${JSON.stringify(grade)}  (${j.judge_usage.input_tokens} in / ${j.judge_usage.output_tokens} out)`)
    for (const [k] of bad) console.log(`           ${k}: ${explanation[k]}`)
    if (chk.name.startsWith('real')) for (const [k, v] of Object.entries(explanation)) console.log(`           ${k}: ${v}`)
}
console.log(mismatches ? `\n${mismatches} verdict(s) differ from the expected calibration` : '\nJudge matches every expected verdict')
process.exit(mismatches ? 1 : 0)
