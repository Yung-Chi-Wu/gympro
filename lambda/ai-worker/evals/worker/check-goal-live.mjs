#!/usr/bin/env node
// Paid check of the goal reader (src/report/goal.ts) on goals written the ways users write them:
// numbers with and without a unit, body weight, body fat, physique, a direction only, things
// it can't track, the library's names in English and Chinese. Each case says what a right read
// has. One Haiku call a case, under US$0.002 each.
//   AWS_PROFILE=<profile> ANTHROPIC_API_KEY_PARAM=/gympro/anthropic-api-key node lambda/ai-worker/evals/worker/check-goal-live.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/worker/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/worker/dist/worker.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const w = createRequire(import.meta.url)(join(here, 'dist', 'worker.cjs'))

const library = JSON.parse(readFileSync(join(worker, '..', '..', 'supabase', 'data', 'exercise-attributes.json'), 'utf8'))
    .map((e) => ({ id: e.id, name: e.name, nameZh: e.nameZh, muscleGroup: e.muscleGroup, primaryMuscles: e.primary, secondaryMuscles: e.secondary, logType: e.logType }))
const byName = (n) => library.find((e) => e.name === n)
const own = ['Barbell Bench Press', 'Barbell Back Squat', 'Lat Pulldown', 'Lateral Raise'].map(byName)
const near = (a, b) => a != null && Math.abs(a - b) <= 0.6

const lift = (r, name) => r.targets.find((t) => t.kind === 'lift' && t.name === name)
const has = (r, kind) => r.kinds.includes(kind)
// A physique goal may name its body parts in one target or one each
const focus = (r) => r.targets.filter((t) => t.kind === 'focus').flatMap((t) => t.units)
const CASES = [
    // "Get stronger" is the kind already: it isn't shown as a part not read
    ['希望可以增加整體力量，深蹲160公斤，臥推70公斤，自重引體', 'kg', (r) => has(r, 'strength') && near(lift(r, 'Barbell Back Squat')?.loadKg, 160) && near(lift(r, 'Barbell Bench Press')?.loadKg, 70) && lift(r, 'Pull-up')?.reps === 1 && !lift(r, 'Pull-up')?.loadKg && !r.unread],
    ['bench 225 lb by summer', 'lb', (r) => near(lift(r, 'Barbell Bench Press')?.loadKg, 102.1) && lift(r, 'Barbell Bench Press')?.unit === 'lb'],
    ['臥推 100', 'kg', (r) => near(lift(r, 'Barbell Bench Press')?.loadKg, 100)],
    ['臥推 100', 'lb', (r) => near(lift(r, 'Barbell Bench Press')?.loadKg, 45.4)],
    ['臥推七十公斤', 'kg', (r) => near(lift(r, 'Barbell Bench Press')?.loadKg, 70)],
    ['squat 140kg x 5', 'kg', (r) => near(lift(r, 'Barbell Back Squat')?.loadKg, 140) && lift(r, 'Barbell Back Squat')?.reps === 5],
    ['做到 10 下引體向上', 'kg', (r) => lift(r, 'Pull-up')?.reps === 10],
    ['能做 20 下伏地挺身', 'kg', (r) => r.targets.some((t) => t.kind === 'lift' && /push-?up/i.test(t.name) && t.reps === 20)],
    ['減到 75 公斤', 'lb', (r) => has(r, 'fat_loss') && r.targets.some((t) => t.kind === 'body_weight' && near(t.weightKg, 75) && t.unit === 'kg')],
    ['體脂降到 15%', 'kg', (r) => r.targets.some((t) => t.kind === 'body_fat' && t.bodyFatPct === 15)],
    ['體態管理', 'kg', (r) => has(r, 'physique') && r.targets.length === 0],
    ['肩膀寬一點，練出腹肌', 'kg', (r) => has(r, 'physique') && focus(r).includes('side_delts') && focus(r).includes('core')],
    ['練大胸肌', 'kg', (r) => (has(r, 'muscle') || has(r, 'physique')) && focus(r).includes('chest')],
    ['增肌', 'kg', (r) => has(r, 'muscle') && r.targets.length === 0],
    ['想變健康，不要受傷', 'kg', (r) => has(r, 'health') && r.targets.length === 0 && !r.unread],
    // "Lose 10 pounds" is no weight to reach: no number may be made up for it
    ['Get stronger and lose 10 pounds', 'lb', (r) => has(r, 'strength') && has(r, 'fat_loss') && !r.targets.some((t) => t.kind === 'body_weight')],
    ['硬舉兩倍體重', 'kg', (r) => !r.targets.some((t) => t.kind === 'lift' && t.loadKg != null) && !!r.unread],
    ['跑完一場半馬', 'kg', (r) => has(r, 'endurance') && !!r.unread],
    ['Front squat 100 kg', 'kg', (r) => near(lift(r, 'Front Squat')?.loadKg, 100) && !lift(r, 'Barbell Back Squat')],
    ['維持現在的身材，一週練三次就好', 'kg', (r) => !r.targets.some((t) => t.kind === 'body_weight' || (t.kind === 'lift' && (t.loadKg != null || t.reps != null)))],
]
if (!byName('Front Squat')) throw new Error('library has no Front Squat')

const client = await w.getClaudeClient()
let ok = 0
let cost = 0
for (const [text, unit, right] of CASES) {
    const { read, call } = await w.readGoal(client, text, { previous: null, own, library, weightUnit: unit })
    cost += (call?.usage.input_tokens ?? 0) / 1e6 * 1 + (call?.usage.output_tokens ?? 0) / 1e6 * 5
    const pass = read?.model ? !!right(read) : false
    if (pass) ok++
    const targets = (read?.targets ?? []).map((t) => t.kind === 'lift' ? `${t.name}${t.loadKg != null ? ` ${t.loadKg}kg(${t.unit})` : ''}${t.reps != null ? ` x${t.reps}` : ''}` : t.kind === 'body_weight' ? `bw ${t.weightKg}kg(${t.unit})` : t.kind === 'body_fat' ? `bf ${t.bodyFatPct}%` : `focus ${t.units.join('+')}`)
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${text} [${unit}] → ${read?.model ? `${read.kinds.join('+') || '-'} | ${targets.join(', ') || '-'}${read.unread ? ` | unread: ${read.unread}` : ''}` : `not read: ${call?.error}`}`)
}
console.log(`\n${ok}/${CASES.length} read right; US$${cost.toFixed(4)}`)
