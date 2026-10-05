#!/usr/bin/env node
// Writes <flow>/<variant>/review.md: per case, every grade with its reason, the
// expected answer, and the report the model wrote - for human review of grading.
//   node lambda/ai-worker/evals/report/review.mjs .claude/hillclimb/weekly-report baseline
// Model output is untrusted, so it goes inside fenced blocks, never as raw markdown/HTML.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const flow = process.argv[2] ?? '.claude/hillclimb/weekly-report'
const variant = process.argv[3] ?? 'baseline'
const vdir = join(flow, variant)

const cases = new Map(JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).map((c) => [c.id, c]))
// Chinese one-liners for each case, kept outside cases.json so the harness hash is unchanged
const whyZh = existsSync(join(here, 'why-zh.json')) ? JSON.parse(readFileSync(join(here, 'why-zh.json'), 'utf8')) : {}
const rows = readFileSync(join(vdir, 'results.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

const LABELS = {
    status_correct: '狀態判斷',
    imbalance_recall: '失衡有抓到',
    no_false_alarm: '沒有誤報失衡',
    deload_correct: '減量判斷',
    language_correct: '語言正確',
    grounded_numbers: '數字有根據（評審）',
    sound_advice: '健身知識正確（評審）',
    note_addressed: '有回應備註（評審）',
}
const STATUS_ZH = { on_track: '進步中', stalling: '停滯', regressing: '退步', insufficient_data: '資料不足' }
const SEVERITY_ZH = { mild: '輕度', moderate: '中度', severe: '嚴重' }
// Stored explanations name statuses by their enum value; show them in Chinese
const zhStatus = (s) => String(s ?? '').replace(/on_track|stalling|regressing|insufficient_data/g, (m) => STATUS_ZH[m])
const mark = (v) => (v == null ? '—' : v === 1 ? '✅' : v === 0 ? '❌' : `${Math.round(v * 100)}%`)
const fence = (text) => {
    const longest = Math.max(2, ...(String(text).match(/`+/g) ?? []).map((s) => s.length))
    const f = '`'.repeat(longest + 1)
    return `${f}text\n${text}\n${f}`
}
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

const passed = rows.filter((r) => r.grade?.pass === 1).length
const out = [
    `# 評分檢視：${variant}（${rows[0]?.model ?? ''}）`,
    '',
    `${rows.length} 題，全部通過 ${passed} 題。每一題請看：評分的理由合不合理？你會給不同的分數嗎？`,
    '',
    '| 題目 | 全部通過 | 狀態 | 失衡 | 誤報 | 減量 | 語言 | 數字 | 知識 | 備註 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => {
        const g = r.grade
        return `| ${r.prompt_id} （第 ${r.rep + 1} 次） | ${mark(g.pass)} | ${mark(g.status_correct)} | ${mark(g.imbalance_recall)} | ${mark(g.no_false_alarm)} | ${mark(g.deload_correct)} | ${mark(g.language_correct)} | ${mark(g.grounded_numbers)} | ${mark(g.sound_advice)} | ${mark(g.note_addressed)} |`
    }),
    '',
]

for (const r of rows) {
    const c = cases.get(r.prompt_id)
    const trace = join(vdir, 'traces', `${r.prompt_id}_rep${r.rep}.json`)
    const report = existsSync(trace) ? JSON.parse(JSON.parse(readFileSync(trace, 'utf8')).find((t) => t.role === 'tool_call')?.content ?? 'null') : null
    out.push(`## ${r.prompt_id}（第 ${r.rep + 1} 次）${r.grade.pass === 1 ? '✅' : '❌'}`, '', whyZh[r.prompt_id] ?? c?.meta?.why ?? '', '')
    out.push('| 項目 | 分數 | 理由 |', '|---|---|---|')
    for (const [k, label] of Object.entries(LABELS)) {
        if (r.grade[k] == null) continue
        out.push(`| ${label} | ${mark(r.grade[k])} | ${cell(zhStatus(r.explanation?.[k]))} |`)
    }
    out.push('')
    if (report) {
        // A malformed report (e.g. progressiveOverload returned as a string) shows as 格式錯誤 rather than undefined
        const malformed = typeof report.progressiveOverload !== 'object' || report.progressiveOverload == null
        const deload = report.deloadRecommended === true ? '建議減量' : report.deloadRecommended === false ? '不減量' : '（缺少這個欄位）'
        const lines = [
            ...(malformed ? ['⚠️ 格式錯誤：progressiveOverload 不是物件，後面的欄位都遺失了', ''] : []),
            `標題：${report.headline}`,
            `狀態：${STATUS_ZH[report.progressiveOverload?.status] ?? '（缺少這個欄位）'}`,
            `進步說明：${report.progressiveOverload?.notes ?? report.notes ?? '（缺少這個欄位）'}`,
            `失衡：${(report.muscleImbalances ?? []).map((m) => `${m.muscleGroup}（${SEVERITY_ZH[m.severity] ?? m.severity}）`).join('；') || '（無）'}`,
            `減量：${deload}${report.deloadReason ? ` — ${report.deloadReason}` : ''}`,
            '行動建議：',
            ...(report.actionItems ?? []).map((a, i) => `  ${i + 1}. ${a}`),
            '',
            `總結：${report.summary}`,
        ]
        out.push('<details><summary>AI 寫的報告</summary>', '', fence(lines.join('\n')), '', '</details>', '')
    }
}

writeFileSync(join(vdir, 'review.md'), out.join('\n'))
console.log(`wrote ${join(vdir, 'review.md')} (${rows.length} rows, ${passed} passed)`)
