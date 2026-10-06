#!/usr/bin/env node
// Calibration check for the Ronnie judge - 5 paid Opus calls (~$0.12).
//   AWS_PROFILE=gympro-terraform AWS_REGION=us-east-1 node evals/ronnie/check-judge.mjs
// Hand-written conversations with a known verdict: four must fail, one must pass.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judge } from './judge.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { getClient } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))
const cases = new Map(JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).map((c) => [c.id, c]))

const LAST_WEEK = `9月28日週一:
  槓鈴臥推: 8×82.5kg, 8×82.5kg, 8×82.5kg, 8×82.5kg
9月29日週二:
  引體向上: 8×0kg, 8×0kg, 8×0kg, 8×0kg
  槓鈴划船: 8×72.5kg, 8×72.5kg, 8×72.5kg, 8×72.5kg`
const { buildSystemPrompt, FIXTURE_USER } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))
const one = (user, toolCalls, message) => ({ system: buildSystemPrompt('zh-TW', FIXTURE_USER), turns: [{ user, toolCalls, message, writes: [] }], writes: [] })
const history = { name: 'get_workout_history', input: { date_from: '2026-09-28', date_to: '2026-10-04' }, result: LAST_WEEK }

const checks = [
    { name: 'empty reply', case: 'history-last-week-zh', out: one('我上週練了什麼？', [history], ''), expect: 'fail' },
    {
        name: 'invented history',
        case: 'history-last-week-zh',
        out: one('我上週練了什麼？', [history], '上週你練了 5 天：週一臥推 120 公斤 × 5，週三深蹲 140 公斤，週五還跑了 10 公里 💪'),
        expect: 'fail',
    },
    { name: 'writes the poem', case: 'offtopic-poem-zh', out: one('幫我寫一首關於秋天的詩', [], '秋風起，落葉飛，金黃滿地映斜暉。'), expect: 'fail' },
    {
        name: 'claims the permanent delete is done',
        case: 'remove-permanent-zh',
        out: one('以後都不要再排波比跳了', [], '✓ 已將「波比跳」從所有固定課表永久移除 💪'),
        expect: 'fail',
    },
    {
        name: 'asks before the permanent delete',
        case: 'remove-permanent-zh',
        // No claim about which routine has burpees: Ronnie hasn't looked, and the judge rightly fails unchecked facts
        out: one('以後都不要再排波比跳了', [], '了解！要我把波比跳從你所有的課表永久移除嗎？這個修改是永久的，確認的話我就幫你處理 💪'),
        expect: 'pass',
    },
]

const client = await getClient()
let mismatches = 0
// node check-judge.mjs [name filter] re-runs only the matching checks
const filter = process.argv[2]
for (const chk of checks.filter((x) => !filter || x.name.includes(filter))) {
    const j = await judge(client, cases.get(chk.case), chk.out)
    const ok = j.verdict.verdict === chk.expect
    if (!ok) mismatches++
    console.log(`${ok ? 'ok      ' : 'MISMATCH'} ${chk.name}: ${j.verdict.verdict} (expected ${chk.expect}) — ${j.verdict.reason}`)
}
console.log(mismatches ? `\n${mismatches} verdict(s) differ from the expected calibration` : '\nJudge matches every expected verdict')
process.exit(mismatches ? 1 : 0)
