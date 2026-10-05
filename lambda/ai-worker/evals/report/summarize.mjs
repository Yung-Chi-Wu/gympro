#!/usr/bin/env node
// Per-variant summary for the weekly-report eval: every metric with a 95% CI,
// plus measured latency, tokens and cost (app + judge) from recorded usage.
//   node lambda/ai-worker/evals/report/summarize.mjs .claude/hillclimb/weekly-report

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const flow = process.argv[2] ?? '.claude/hillclimb/weekly-report'
const state = JSON.parse(readFileSync(join(flow, '_state.json'), 'utf8'))
const price = (model, usage) => {
    // The served id can carry a date suffix (claude-haiku-4-5-20251001), so fall back to a prefix match
    const p = state.prices?.[model] ?? Object.entries(state.prices ?? {}).find(([k]) => model?.startsWith(k))?.[1]
    if (!p || !usage) return 0
    return ((usage.input_tokens ?? 0) * p.in + (usage.output_tokens ?? 0) * p.out) / 1e6
}
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [])
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }

const variants = readdirSync(flow).filter((d) => /^(baseline|v\d+)$/.test(d)).sort((a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : +a.slice(1) - +b.slice(1)))
for (const v of variants) {
    const rows = readJsonl(join(flow, v, 'results.jsonl'))
    const errors = readJsonl(join(flow, v, 'errors.jsonl'))
    const ok = rows.filter((r) => (r.status ?? 'ok') === 'ok')
    const models = [...new Set(rows.map((r) => r.model))].join(', ')
    console.log(`\n== ${v}  (${models || 'no rows'})  ${ok.length} scored rows over ${new Set(ok.map((r) => r.prompt_id)).size} cases, ${rows.length - ok.length} truncated, ${errors.length} errors`)

    for (const m of state.metrics) {
        const xs = ok.map((r) => r.grade?.[m.id]).filter((x) => typeof x === 'number')
        if (!xs.length) { console.log(`  ${m.label.padEnd(14)}   n/a`); continue }
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length
        const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1))
        const half = 1.96 * (sd / Math.sqrt(xs.length))
        console.log(`  ${m.label.padEnd(14)} ${(mean * 100).toFixed(0).padStart(4)}%  ±${(half * 100).toFixed(0)}  (n=${xs.length})`)
    }

    const appCost = ok.map((r) => price(r.model, r.usage))
    const judgeCost = ok.map((r) => price(r.judge_model, r.judge_usage))
    const errCost = errors.reduce((a, e) => a + price(e.model, e.usage) + price(e.judge_model, e.judge_usage), 0)
    const sum = (xs) => xs.reduce((a, b) => a + b, 0)
    // attempts > 1 means the first report failed the Zod schema and was regenerated
    const retried = ok.filter((r) => (r.attempts ?? 1) > 1).length
    const invalid = errors.filter((e) => e.failure_class === 'invalid_output').length
    if (ok.some((r) => r.attempts != null)) console.log(`  format retry   ${retried} of ${ok.length} reports needed a second attempt, ${invalid} failed both`)
    console.log(`  latency        median ${median(ok.map((r) => r.latency_s)).toFixed(1)}s (max ${Math.max(...ok.map((r) => r.latency_s)).toFixed(1)}s)`)
    console.log(`  tokens / case  median ${median(ok.map((r) => r.usage?.input_tokens))} in, ${median(ok.map((r) => r.usage?.output_tokens))} out`)
    console.log(`  cost           app $${(sum(appCost) / ok.length).toFixed(4)}/report, judge $${(sum(judgeCost) / ok.length).toFixed(4)}/case, total spent $${(sum(appCost) + sum(judgeCost) + errCost).toFixed(2)}`)
}
