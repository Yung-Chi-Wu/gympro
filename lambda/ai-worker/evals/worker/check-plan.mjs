#!/usr/bin/env node
// Free check of the next-session advice (report/plan.ts) and the text code writes for it
// (lib/report/report-text.ts planItems): no model, no database. A plan keeps the user's weight and
// adds reps up to two more, then the smallest step for the equipment in the user's unit (a wider
// range when the step is over 10%); an assisted lift lowers the assist, a bodyweight one adds reps.
// The goal's lifts get the routine's way first and the other ways after; a lift that hurt is held
// with a lighter alternative; Ronnie's notes rule options out. The text reads as written, in
// both languages, in priority order with the model's items, and is followed up next report. The
// brief says what the headline can't claim when a lift, or the lift a goal rests on, didn't go up.
//   node lambda/ai-worker/evals/worker/check-plan.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inputsFor, SCENARIOS } from '../report-v3/scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/worker/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/worker/dist/worker.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const w = createRequire(import.meta.url)(join(here, 'dist', 'worker.cjs'))

let failed = 0
const check = (name, ok, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

// ---------- One lift's next session ----------

const ex = (id, name, extra = {}) => ({ id, name, nameZh: null, muscleGroup: 'chest', primaryMuscles: ['chest'], secondaryMuscles: [], logType: 'weight_reps', jointLoad: null, equipment: 'barbell', ...extra })
const set = (exerciseId, weightKg, reps, extra = {}) => ({ date: '2026-10-12', workoutId: 'w1', exerciseId, reps, weightKg, durationS: null, speedKmh: null, distanceM: null, assistKg: null, loggedAt: '2026-10-12T18:00:00Z', ...extra })
const windowOf = (date) => (date >= '2026-10-12' ? 0 : 1)
{
    const bench = ex('b', 'Barbell Bench Press')
    const sets = [set('b', 42.5, 8), set('b', 42.5, 9), set('b', 42.5, 8), set('b', 35, 20), { ...set('b', 50, 5), date: '2026-10-05' }]
    const rx = w.prescribe(bench, sets, 'kg', windowOf)
    check('the heaviest weight this period, its fewest reps up to two more, then 2.5 kg on an upper-body barbell', rx.how === 'load' && rx.weightKg === 42.5 && rx.low === 8 && rx.top === 10 && rx.nextKg === 45 && rx.sets === 3, JSON.stringify(rx))
    const lb = w.prescribe(bench, [set('b', 42.64, 8)], 'lb', windowOf)
    check('in lb: 94 lb, then 99 lb (5 lb), stored in kg', lb.nextKg === 44.91, JSON.stringify(lb))
    const squat = w.prescribe(ex('s', 'Barbell Back Squat', { muscleGroup: 'legs', primaryMuscles: ['quads', 'glutes'] }), [set('s', 65, 8)], 'kg', windowOf)
    check('a lower-body lift steps by 5 kg', squat.nextKg === 70, JSON.stringify(squat))
    const db = w.prescribe(ex('d', 'Dumbbell Bench Press', { equipment: 'dumbbell' }), [set('d', 15, 10)], 'kg', windowOf)
    check('a dumbbell steps by 2 kg; over 10% of the weight, the range goes 4 reps higher first', db.nextKg === 17 && db.top === 14, JSON.stringify(db))
    const high = w.prescribe(bench, [set('b', 20, 15)], 'kg', windowOf)
    check('at 15 reps or more, the weight goes up now', high.how === 'load_now', JSON.stringify(high))
    const assisted = w.prescribe(ex('a', 'Assisted Pull-up', { logType: 'assisted' }), [set('a', 0, 8, { assistKg: 30 }), set('a', 0, 6, { assistKg: 25 }), set('a', 0, 7, { assistKg: 25 })], 'kg', windowOf)
    check('an assisted lift keeps its least assist and its fewest reps there', assisted.how === 'assist' && assisted.assistKg === 25 && assisted.low === 6 && assisted.top === 8, JSON.stringify(assisted))
    const reps = w.prescribe(ex('p', 'Push-up', { logType: 'bodyweight' }), [set('p', 0, 12), set('p', 0, 10)], 'kg', windowOf)
    check('a bodyweight lift adds reps', reps.how === 'reps' && reps.low === 10 && reps.top === 12, JSON.stringify(reps))
    check('no sets this period: no plan', w.prescribe(bench, [{ ...set('b', 40, 8), date: '2026-10-05' }], 'kg', windowOf) === null)
}

// ---------- The text, as the owner reads it ----------

const scenario = (id) => SCENARIOS.find((x) => x.id === id)
const report = (id, over = {}) => w.analyze({ ...inputsFor(scenario(id)), ...over })
const braces = (items) => items.flatMap((i) => [i.action, ...(i.lines ?? []).flatMap((l) => [l.label, l.text])]).filter((x) => /[{}]/.test(x))
{
    const a = report('goal-strength-owner-zh')
    const items = w.planItems(a.findings, 'zh-TW', 'week', 'kg')
    const of = (id) => items.find((i) => i.findingId === id)
    const bench = of('goal_path:ex-bench')
    check("the bench reads as the mock: the routine's way, then heavy first and a second day", bench?.action === '槓鈴臥推：42.5 kg 做 3 組 × 8–10 下，每組都做到 10 下就換 45 kg'
        && JSON.stringify(bench.lines?.map((l) => `${l.label}：${l.text}`)) === JSON.stringify(['或：先做重的，45 kg 做 3 組 × 4–6 下，再做原本的組', '或：一週多一天槓鈴臥推，40 kg 做 3 組 × 5 下']), JSON.stringify(bench))
    const pull = of('goal_path:ex-pullup')
    check('a first pull-up goes through the pulldown the user trains, to the set that marks the try', pull?.action === '引體向上：滑輪下拉 50 kg 做 4 組 × 6–8 下，每組都做到 8 下就換 52.5 kg；能做 55 kg × 6 下時，試一下引體向上'
        && pull.lines?.map((l) => l.text).join('|') === '輔助引體向上做 3 組 × 5–8 下，每組都做到 8 下就減一格輔助|離心引體向上做 3 組 × 2–3 下，每下慢慢放 3–5 秒', JSON.stringify(pull))
    const next = items.find((i) => i.rule === 'next_session')
    check('the other main lifts are one item, a line each, after the goal\'s; the pulldown is in the pull-up\'s plan, not again here', next?.action === '其他動作：每組都做到次數上限，下次再加重' && next.lines.map((l) => l.label).join() === '側平舉,腿彎舉' && items.indexOf(next) === 3, JSON.stringify(next))
    check('no placeholder is left in any line (zh)', braces(items).length === 0, JSON.stringify(braces(items)))
    const en = w.planItems(a.findings, 'en', 'week', 'kg')
    check('in English too', en.find((i) => i.findingId === 'goal_path:ex-bench')?.action === 'Barbell Bench Press: 42.5 kg for 3 sets of 8–10; when every set reaches 10, go to 45 kg' && braces(en).length === 0, JSON.stringify(en[1]))
    const lb = w.planItems(report('goal-strength-owner-zh', { weightUnit: 'lb' }).findings, 'zh-TW', 'week', 'lb')
    check('a user who logs lb reads lb and 5 lb steps', lb.find((i) => i.findingId === 'goal_path:ex-bench')?.action === '槓鈴臥推：93.7 lb 做 3 組 × 8–10 下，每組都做到 10 下就換 98.7 lb', JSON.stringify(lb[1]))
}
{
    // Without a goal: one item, "to keep progressing", and no volume advice
    const a = report('first-report-zh')
    const items = w.planItems(a.findings, 'zh-TW', 'week', 'kg')
    check('without a goal the advice is one item for the main lifts', items.length === 1 && items[0].action === '想再進步的話：每組都做到次數上限，下次再加重' && items[0].lines.length === 3 && !a.findings.some((f) => f.rule === 'low_volume'), JSON.stringify(items))
}
{
    const a = report('goal-pain-and-notes-zh')
    const items = w.planItems(a.findings, 'zh-TW', 'week', 'kg')
    const hold = items[0]
    const alt = a.findings.find((f) => f.id === 'pain_hold:ex-bench')?.data
    const altEx = inputsFor(scenario('goal-pain-and-notes-zh')).exercises.find((e) => e.id === alt?.altId)
    check('a lift that hurt comes first: no more weight, a lighter alternative, and getting it looked at', hold?.findingId === 'pain_hold:ex-bench' && hold.action === '槓鈴臥推：這週先不加重，42.5 kg × 8 下就好'
        && hold.lines?.at(-1)?.label === '還痛的話' && hold.lines.length === 2, JSON.stringify(hold))
    check('the alternative trains the same muscle and loads the elbow lightly', altEx && altEx.primaryMuscles[0] === 'chest' && altEx.jointLoad?.elbow === 'low', JSON.stringify(altEx))
    const squat = a.findings.find((f) => f.id === 'goal_path:ex-squat')
    check('an injured knee in Ronnie\'s notes leaves the squat no heavier or extra-day option', squat?.data.options === '' && squat.data.injury === '左膝有舊傷' && !items.find((i) => i.findingId === 'goal_path:ex-squat')?.lines, JSON.stringify(squat?.data))
    const pull = a.findings.find((f) => f.id === 'goal_path:ex-pullup')
    check('an exercise the user doesn\'t want is never an option, and the reason says why', pull?.data.options === 'negatives' && pull.data.dislike === '不想做輔助引體', JSON.stringify(pull?.data))
}
{
    const a = report('goal-bench-stalled-en')
    const bench = w.planItems(a.findings, 'en', 'week', 'kg').find((i) => i.findingId === 'goal_path:ex-bench')
    check('a stalled goal lift drops 10% and builds back, in place of the stall rule', bench?.action === 'Barbell Bench Press: stuck at 90 kg for 5 weeks; drop to 80 kg for 3 sets of 5–7 and build back up' && !a.findings.some((f) => f.rule === 'lift_stalled'), JSON.stringify(bench))
}

// ---------- With the model's items, and the fallback ----------

{
    const findings = [
        { id: 'deload:-', rule: 'deload', subject: null, priority: 100, data: {} },
        ...report('goal-pain-and-notes-zh').findings,
        { id: 'low_volume:chest', rule: 'low_volume', subject: 'chest', priority: 50, data: {} },
    ].sort((x, y) => y.priority - x.priority)
    const n = w.withPlanItems({ headline: 'h', items: [{ rule: 'deload', action: '減量。' }, { rule: 'low_volume', action: '加組。', lines: [] }] }, findings, 'zh-TW', 'week', 'kg')
    const order = n.items.map((i) => i.rule ?? i.findingId.split(':')[0])
    check('every item in priority order: deload, the held lift, the goal\'s, the other lifts, then volume', JSON.stringify(order) === JSON.stringify(['deload', 'pain_hold', 'goal_path', 'goal_path', 'next_session', 'low_volume']), JSON.stringify(order))
    const a = report('goal-strength-owner-zh')
    const fallback = w.fallbackNarrative(a.facts, a.findings, 'zh-TW', 'kg')
    check('the fallback text keeps the plan', fallback.items.length === 4 && fallback.items[0].findingId === 'goal_path:ex-squat', JSON.stringify(fallback.items.map((i) => i.findingId ?? i.rule)))
}
{
    // The model writes none of the plan: its schema has no action for it, and the brief says code writes it
    const a = report('goal-pain-and-notes-zh')
    const calls = []
    const client = { messages: { create: async (params) => {
        calls.push(params)
        return { model: 'm', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't', name: 'submit_report_text', input: { headline: '臥推先不加重，其他照計畫練。', actions: {} } }] }
    } } }
    const log = console.log
    console.log = () => {}
    const r = await w.generateNarrative({ ...a, note: null, language: 'zh-TW', weightUnit: 'kg' }, 'm', { client }).finally(() => { console.log = log })
    const schema = calls[0]?.tools[0].input_schema
    check('the model has no action to write for the plan', Object.keys(schema?.properties?.actions?.properties ?? {}).length === 0, JSON.stringify(schema?.properties?.actions))
    check('the brief tells it what code wrote, so the headline agrees', /Code writes this advice in the app[^\n]*holding 槓鈴臥推[^\n]*深蹲, 引體向上/.test(calls[0]?.messages[0].content ?? ''), (calls[0]?.messages[0].content ?? '').split('\n').find((l) => l.startsWith('Code writes')))
    check('and the report has the plan\'s items', r.narrative.items.map((i) => i.findingId ?? i.rule).join() === 'pain_hold:ex-bench,goal_path:ex-squat,goal_path:ex-pullup,next_session', JSON.stringify(r.narrative.items.map((i) => i.findingId ?? i.rule)))
}
{
    // What the headline can't claim: progress across the board with a lift not up, or the goal on
    // track with the lift it rests on stuck, once code writes that lift's advice (v14)
    const briefOf = (id) => {
        const a = report(id)
        return w.buildPrompt({ ...a, note: null, language: scenario(id).language, weightUnit: scenario(id).weightUnit ?? 'kg' }).split('\n')
    }
    const headlineOf = (id) => briefOf(id).find((l) => l.startsWith('1. headline'))
    check('every lift up: nothing the headline can\'t claim', !/Not every|goal rests/.test(headlineOf('all-progress-en')), headlineOf('all-progress-en'))
    check('one lift flat: not across the board, in Chinese too', /Not every main lift went up, so it doesn't say every, all or across the board \(全面\)\./.test(headlineOf('lb-user-zh')) && !/goal rests/.test(headlineOf('lb-user-zh')), headlineOf('lb-user-zh'))
    check('a goal lift flat for 5 weeks: the goal isn\'t on track', headlineOf('goal-bench-stalled-en').includes('The goal rests on Barbell Bench Press (flat for 5 weeks), so it doesn\'t say the goal is on track or close'), headlineOf('goal-bench-stalled-en'))
    check('the lift a pull-up goal is trained through counts too', headlineOf('assisted-stalled-en').includes('The goal rests on Assisted Pull-up (flat for 3 weeks)'), headlineOf('assisted-stalled-en'))
    check('goal lifts flat for one week: no limit on the goal', !/goal rests/.test(headlineOf('goal-strength-owner-zh')), headlineOf('goal-strength-owner-zh'))
    const code = briefOf('goal-bench-stalled-en').find((l) => l.startsWith('Code writes'))
    check('the brief says the stalled goal lift starts lighter', code?.includes('Barbell Bench Press stalled, so its plan starts lighter and builds back up'), code)
}

// ---------- Next report ----------

{
    const previous = [{ id: 'goal_path:ex-bench', rule: 'goal_path', subject: 'ex-bench', priority: 65, data: { how: 'load', weightKg: 42.5, low: 8, top: 10, nextKg: 45 } }]
    const status = (best) => {
        const facts = { muscles: [], sessions: { done: 1, planned: null }, totalSets: { now: 1 }, bodyWeight: { weighIns: 0 } }
        return w.followUp(previous, facts, () => (best ? { best, trend: 'up', series: [] } : null))[0]
    }
    check('followed up: the next weight is done', status({ weightKg: 45, reps: 8 }).status === 'done')
    check('more reps at the same weight is partial', status({ weightKg: 42.5, reps: 10 }).status === 'partial')
    check('the same set is not done', status({ weightKg: 42.5, reps: 8 }).status === 'not_done')
    check('not trained says so', status(null).data.trained === 0)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
