#!/usr/bin/env node
// Free check of the report backtest (backtest.ts) on users made up with known answers: no model,
// no database. A user who lifts what each plan says is scored as following every plan and hitting
// its range, steps up included; one who lifts less, as lighter. A drop that lasts is a regression
// not back; one bad day is one back; a small dip is no regression, though the plainest rule counts
// it as a drop. A stall that breaks is scored as beaten. A week is read with nothing logged after
// it, and the summary is counts alone.
//   node lambda/ai-worker/evals/backtest/check-backtest.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXERCISES } from '../report-v3/scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/backtest/backtest.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/backtest/dist/backtest.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const b = createRequire(import.meta.url)(join(here, 'dist', 'backtest.cjs'))

let failed = 0
const check = (name, ok, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

// ---------- Made-up users ----------

// Mondays, one session a week, so each week's plan is checked against the next week's session
const FIRST = '2026-08-03'
const monday = (i) => {
    const d = new Date(`${FIRST}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7 * i)
    return d.toISOString().slice(0, 10)
}
/** One session's sets of one exercise: [kg, reps] each, three minutes apart */
const session = (week, key, specs, from = 0) => specs.map(([kg, reps], i) => ({
    date: monday(week), workoutId: `w-${week}`, exerciseId: `ex-${key}`, reps, weightKg: kg, durationS: null, speedKmh: null, distanceM: null, assistKg: null,
    loggedAt: new Date(Date.parse(`${monday(week)}T18:00:00Z`) + (from + i) * 180_000).toISOString(),
}))
const times = (n, kg, reps) => Array.from({ length: n }, () => [kg, reps])
// Eight sets of curls every week at the same weight, so each week has the sets advice needs; the curl's own outcomes are left out below
const filler = (week) => session(week, 'curl', times(8, 30, 10), 10)
const BASE = { exercises: EXERCISES, schedule: null, weighIns: [], goal: null, notes: [], weightUnit: 'kg', goalRead: null }

/** A user's weeks replayed and scored, and the outcomes of one exercise */
function run(sets, leads, weeks) {
    const past = b.weeksFrom(sets, { ...BASE, routineLeads: leads.map((k) => `ex-${k}`) }, FIRST, weeks)
    const decisions = b.replay(past)
    const outcomes = b.score(decisions)
    const of = (key) => Object.fromEntries(Object.entries(outcomes).map(([kind, list]) => [kind, list.filter((x) => x.exerciseId === `ex-${key}`)]))
    return { past, decisions, outcomes, of, summary: b.summarize(decisions, outcomes) }
}

// ---------- Plans ----------

{
    // Double progression as the plan gives it: 60 kg for 8 to 10, every set at 10, then 62.5, and on to 65
    const bench = [[60, 8], [60, 9], [60, 10], [62.5, 8], [62.5, 9], [62.5, 10], [65, 8]]
    const sets = bench.flatMap(([kg, reps], w) => [...session(w, 'bench', times(3, kg, reps)), ...filler(w)])
    const u = run(sets, ['bench'], bench.length)
    const plans = u.of('bench').plans
    check('a week is read with nothing logged after it', u.past.every((w) => w.inputs.sets.every((s) => s.date <= w.inputs.periodEnd)))
    check('each week with the sets advice needs plans the next session of its lift', plans.length === bench.length && u.decisions.every((d) => d.advice), JSON.stringify(plans.map((p) => p.targetKg)))
    check('a user who lifts what each plan says follows every plan and hits its range', plans.slice(0, -1).every((p) => p.followed === 'same' && p.hit === true), JSON.stringify(plans.map((p) => [p.targetKg, p.followed, p.hit])))
    check('the plan steps up once every set reaches the top, and the step-up is lifted as planned',
        plans.filter((p) => p.stepUp).map((p) => p.targetKg).join() === '62.5,65' && plans.filter((p) => p.stepUp).every((p) => p.followed === 'same'), JSON.stringify(plans.map((p) => [p.targetKg, p.stepUp])))
    check('a session with every set at the top is counted as the step due already', plans.filter((p) => p.topped).length === 2, JSON.stringify(plans.map((p) => p.topped)))
    check('the last week\'s plan, with no session after it, is planned but not done again, as the logs ending', plans.at(-1).followed === null && plans.at(-1).hit === null && plans.at(-1).unseen === 'ended')
    check('lifting a heavier step in its range reads as no regression', u.of('bench').regressions.length === 0, JSON.stringify(u.of('bench').regressions))
    check('the plainest rule reads the step up as a drop, and it is back the week after', u.of('bench').drops.length === 2 && u.of('bench').drops[0].passed === true && u.of('bench').drops[1].passed === null, JSON.stringify(u.of('bench').drops))
}

{
    const sets = [...session(0, 'bench', times(3, 60, 8)), ...filler(0), ...session(1, 'bench', times(3, 55, 8)), ...filler(1)]
    const first = run(sets, ['bench'], 2).of('bench').plans[0]
    check('a user who lifts less than the plan is counted as lighter, and no range is checked', first.followed === 'lighter' && first.hit === null, JSON.stringify(first))
}

{
    const sets = [...session(0, 'bench', times(3, 60, 8)), ...session(1, 'bench', times(3, 60, 9))]
    const u = run(sets, ['bench'], 2)
    check('a week under the sets advice needs has no plan and no flag', u.decisions.every((d) => !d.advice && d.plans.length === 0 && d.findings.length === 0) && u.outcomes.plans.length === 0)
}

// ---------- Regressions and drops ----------

/** A lift at one level for four weeks, then the given weeks after */
function lift(key, level, after, leads) {
    const weeks = [...times(4, ...level), ...after]
    // A [null] week trains only the curls
    const sets = weeks.flatMap(([kg, reps], w) => [...(kg == null ? [] : session(w, key, times(4, kg, reps))), ...filler(w)])
    return run(sets, leads ?? [key], weeks.length).of(key)
}

{
    const squat = lift('squat', [100, 6], [[90, 6], [90, 6]])
    check('a drop that lasts is a regression, still below its level the week after', squat.regressions.length === 1 && squat.regressions[0].passed === false, JSON.stringify(squat.regressions))
    const rdl = lift('rdl', [90, 8], [[80, 8], [90, 8]])
    check('one bad day is a regression that is back the week after', rdl.regressions.length === 1 && rdl.regressions[0].passed === true, JSON.stringify(rdl.regressions))
    const row = lift('row', [70, 8], [[67.5, 8], [70, 8]])
    check('a small dip is no regression, but the plainest rule counts it as a drop that is back', row.regressions.length === 0 && row.drops.length === 1 && row.drops[0].passed === true, JSON.stringify(row))
    // Four other lifts come in the week of the drop with more sets than the squat has in its windows
    // by the week after, when the squat is done in one set: no main lift that week, but trained
    const others = (w) => ['bench', 'ohp', 'row', 'rdl'].flatMap((k, i) => session(w, k, times(12, 50, 8), 20 + 12 * i))
    const busy = [
        ...[0, 1, 2, 3].flatMap((w) => [...session(w, 'squat', times(4, 100, 6)), ...filler(w)]),
        ...session(4, 'squat', times(4, 90, 6)), ...others(4), ...filler(4),
        ...session(5, 'squat', [[100, 6]]), ...others(5), ...filler(5),
    ]
    const moved = run(busy, [], 6)
    check('a regression is scored by the lift\'s own sets after it, though it is no main lift that week',
        moved.decisions[4].facts.lifts.some((l) => l.exerciseId === 'ex-squat') && moved.decisions[5].facts.lifts.every((l) => l.exerciseId !== 'ex-squat')
            && moved.of('squat').regressions[0]?.passed === true,
        JSON.stringify({ week4: moved.decisions[4].facts.lifts.map((l) => l.exerciseId), week5: moved.decisions[5].facts.lifts.map((l) => l.exerciseId), regressions: moved.of('squat').regressions }))
    const late = lift('squat', [100, 6], [[90, 6]])
    check('a regression in the last week, with nothing after it, is flagged and not scored, as the logs ending', late.regressions.length === 1 && late.regressions[0].passed === null && late.regressions[0].next === null && late.regressions[0].unseen === 'ended', JSON.stringify(late.regressions))
    const dropped = lift('squat', [100, 6], [[90, 6], [null], [null], [null]])
    check('a regression whose lift isn\'t trained in the weeks after is not scored, as not trained', dropped.regressions[0]?.passed === null && dropped.regressions[0]?.unseen === 'not_trained', JSON.stringify(dropped.regressions))
}

// ---------- Stalls ----------

{
    const ohp = lift('ohp', [45, 8], [[47.5, 8]])
    const first = ohp.stalls[0]
    check('a lift flat for three weeks after its best is flagged as stalled, and beaten the week after', ohp.stalls.length >= 1 && first?.passed === true && first.next > first.before, JSON.stringify(ohp.stalls))
    const stuck = lift('ohp', [45, 8], [[45, 8], [45, 8]])
    check('a stall that holds is scored as not beaten', stuck.stalls.length >= 1 && stuck.stalls.every((s) => s.passed !== true), JSON.stringify(stuck.stalls))
}

// ---------- The summary ----------

{
    const sets = [[60, 8], [60, 10], [62.5, 8]].flatMap(([kg, reps], w) => [...session(w, 'bench', times(3, kg, reps)), ...filler(w)])
    const one = run(sets, ['bench'], 3).summary
    const two = b.addUp([one, one])
    check('accounts\' summaries add up', two.accounts === 2 && two.weeks === 2 * one.weeks && two.plans.same === 2 * one.plans.same && two.drops.flagged === 2 * one.drops.flagged, JSON.stringify(two))
    const numbers = (o) => Object.values(o).every((v) => (typeof v === 'object' ? numbers(v) : typeof v === 'number'))
    check('a summary is counts alone: no exercise, date or account in it', numbers(two) && !/ex-|20\d\d-/.test(JSON.stringify(two)), JSON.stringify(two))
    const lines = b.summaryLines(two)
    check('the summary reads each rate with the counts it comes from', lines.some((l) => /lifted at the planned weight\s+\d+% \(\d+\/\d+\)/.test(l)) && lines.some((l) => /^Regressions flagged: \d+/.test(l)), lines.join('\n'))
}

console.log(failed ? `\n${failed} failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
