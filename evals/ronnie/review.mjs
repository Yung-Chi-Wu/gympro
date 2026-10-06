#!/usr/bin/env node
// Writes <flow>/<variant>/review.md: per case, every check with its reason and
// the full conversation (tool calls included), in Chinese, for human review.
//   node evals/ronnie/review.mjs .claude/hillclimb/ronnie baseline
// Model output is untrusted, so it goes inside fenced blocks, never as raw markdown/HTML.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const flow = process.argv[2] ?? '.claude/hillclimb/ronnie'
const variant = process.argv[3] ?? 'baseline'
const vdir = join(flow, variant)

const cases = new Map(['cases.json', 'cases-holdout.json'].flatMap((f) => JSON.parse(readFileSync(join(here, f), 'utf8'))).map((c) => [c.id, c]))
const order = [...cases.keys()]
const rows = readFileSync(join(vdir, 'results.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    .sort((a, b) => order.indexOf(a.prompt_id) - order.indexOf(b.prompt_id) || a.rep - b.rep)

const LABELS = {
    right_tools: '用對工具',
    change_done: '該改的有改',
    no_wrong_change: '沒有改錯',
    valid_ids: 'ID 沒抄錯（參考）',
    mentions_expected: '內容完整',
    date_range: '日期範圍',
    no_fallback: '沒有放棄回答',
    language_correct: '語言正確',
    judge_ok: '評審通過',
    asks_first: '永久修改先問',
}
const mark = (v) => (v == null ? '—' : v === 1 ? '✅' : '❌')
const fence = (text) => {
    const longest = Math.max(2, ...(String(text).match(/`+/g) ?? []).map((s) => s.length))
    const f = '`'.repeat(longest + 1)
    return `${f}text\n${text}\n${f}`
}
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const short = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}…（省略 ${s.length - n} 字）` : s)

const passed = rows.filter((r) => r.grade?.pass === 1).length
const out = [
    `# 羅尼測試檢視：${variant}（${rows[0]?.model ?? ''}）`,
    '',
    `${rows.length} 次對話，全部通過 ${passed} 次。每一題請看：評分理由合不合理？你會給不同的分數嗎？`,
    '',
    '| 題目 | 全部通過 | 工具 | 該改有改 | 沒改錯 | ID | 內容 | 日期 | 沒放棄 | 語言 | 評審 | 先問 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => {
        const g = r.grade
        return `| ${r.prompt_id}（第 ${r.rep + 1} 次） | ${mark(g.pass)} | ${mark(g.right_tools)} | ${mark(g.change_done)} | ${mark(g.no_wrong_change)} | ${mark(g.valid_ids)} | ${mark(g.mentions_expected)} | ${mark(g.date_range)} | ${mark(g.no_fallback)} | ${mark(g.language_correct)} | ${mark(g.judge_ok)} | ${mark(g.asks_first)} |`
    }),
    '',
]

for (const r of rows) {
    const c = cases.get(r.prompt_id)
    out.push(`## ${r.prompt_id}（第 ${r.rep + 1} 次）${r.grade.pass === 1 ? '✅' : '❌'}`, '', c?.meta?.why ?? '', '')
    out.push('| 項目 | 分數 | 理由 |', '|---|---|---|')
    for (const [k, label] of Object.entries(LABELS)) {
        if (r.grade[k] == null) continue
        out.push(`| ${label} | ${mark(r.grade[k])} | ${cell(r.explanation?.[k])} |`)
    }
    out.push('')
    const trace = join(vdir, 'traces', `${r.prompt_id}_rep${r.rep}.json`)
    if (existsSync(trace)) {
        const lines = JSON.parse(readFileSync(trace, 'utf8')).map((m) => {
            if (m.role === 'user') return `你：${m.content}`
            if (m.role === 'assistant') return `羅尼：${m.content}\n`
            const { input, result } = JSON.parse(m.content)
            return `  [工具 ${m.name}] ${JSON.stringify(input)}\n    → ${short(String(result).replace(/\n/g, ' ⏎ '))}`
        })
        out.push(`<details><summary>完整對話（${r.api_calls} 次 API 呼叫）</summary>`, '', fence(lines.join('\n')), '', '</details>', '')
    }
}

writeFileSync(join(vdir, 'review.md'), out.join('\n'))
console.log(`wrote ${join(vdir, 'review.md')} (${rows.length} rows, ${passed} passed)`)
