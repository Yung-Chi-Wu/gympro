#!/usr/bin/env node
// Calibration check for the Ronnie judge - 12 paid Opus calls (~$0.30); a name filter runs fewer.
//   AWS_PROFILE=gympro-terraform AWS_REGION=us-east-1 node evals/ronnie/check-judge.mjs
// Hand-written conversations with a known verdict.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judge } from './judge.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { getClient } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))
const cases = new Map(['cases.json', 'cases-knowledge.json'].flatMap((f) => JSON.parse(readFileSync(join(here, f), 'utf8'))).map((c) => [c.id, c]))

const LAST_WEEK = `9月28日週一:
  槓鈴臥推: 8×82.5kg, 8×82.5kg, 8×82.5kg, 8×82.5kg
9月29日週二:
  引體向上: 8×0kg, 8×0kg, 8×0kg, 8×0kg
  槓鈴划船: 8×72.5kg, 8×72.5kg, 8×72.5kg, 8×72.5kg`
const { buildSystemPrompt, FIXTURE_USER } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))
const one = (user, toolCalls, message) => ({ system: buildSystemPrompt('zh-TW', FIXTURE_USER), turns: [{ user, toolCalls, message, writes: [] }], writes: [] })
const BENCH_HISTORY = {
    name: 'get_workout_history',
    input: { date_from: '2026-09-21', date_to: '2026-10-07' },
    result: ['9月22日週二', '9月28日週一', '10月1日週四', '10月4日週日'].map((d, i) => `${d}:\n  槓鈴臥推: ${Array(4).fill(i ? '8×82.5kg' : '8×80kg').join(', ')}`).join('\n\n')
        + '\n\n10月7日週三:\n  槓鈴臥推: 8×82.5kg, 8×82.5kg, 8×82.5kg',
}
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
    // ---------- knowledge set (node check-judge.mjs knowledge) ----------
    { name: 'knowledge: knees must not pass the toes', case: 'knowledge-knees-toes-zh', out: one('深蹲膝蓋可以超過腳尖嗎？', [], '不行，深蹲時膝蓋絕對不要超過腳尖，不然膝蓋會受傷。屁股往後坐，小腿保持垂直 💪'), expect: 'fail' },
    {
        name: 'knowledge: knees past the toes is normal',
        case: 'knowledge-knees-toes-zh',
        out: one('深蹲膝蓋可以超過腳尖嗎？', [], '可以，蹲得深時膝蓋超過腳尖很正常，能超過多少跟腿長和腳踝活動度有關。硬要擋住反而會把壓力轉到髖和下背。重點是膝蓋朝腳尖方向、動作不痛 💪'),
        expect: 'pass',
    },
    { name: 'knowledge: crunches burn belly fat', case: 'knowledge-spot-reduction-zh', out: one('我想瘦肚子，每天做仰臥起坐有用嗎？', [], '有用！每天 100 下仰臥起坐，肚子的脂肪就會慢慢燒掉，一個月就看得到腹肌 💪'), expect: 'fail' },
    { name: 'knowledge: creatine hurts the kidneys', case: 'knowledge-creatine-zh', out: one('肌酸有用嗎？要吃多少？', [], '肌酸會傷腎，長期吃對身體不好，不建議。想增肌就把蛋白質吃夠就好 💪'), expect: 'fail' },
    { name: 'knowledge: plateau advice without the data', case: 'knowledge-bench-plateau-zh', out: one('我臥推好像卡住了，怎麼辦？', [], '卡關很正常！試試漸進超負荷、換成啞鈴臥推或上斜臥推，並且多休息、吃夠蛋白質 💪'), expect: 'fail' },
    {
        name: 'knowledge: plateau with an invented long stall',
        case: 'knowledge-bench-plateau-zh',
        out: one('我臥推好像卡住了，怎麼辦？', [BENCH_HISTORY], '你已經卡在 82.5 公斤一個多月了，建議先減量一週，再換成 5×5 的課表重新建立力量 💪'),
        expect: 'fail',
    },
    {
        name: 'knowledge: plateau read from the data',
        case: 'knowledge-bench-plateau-zh',
        out: one('我臥推好像卡住了，怎麼辦？', [BENCH_HISTORY], '我看了紀錄：9/22 是 80kg×8，9/28 起四次推日都是 82.5kg×8，才十天左右，算正常的停滯。下一步先在 82.5kg 把每組做到 10 下，再加到 85kg；也確認睡眠和蛋白質夠。三個月衝 100kg 很拚，每兩週進步 2.5kg 就有機會 💪'),
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
