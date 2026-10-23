#!/usr/bin/env node
// Free check of the v3 report's code half: each scenario runs through analyze() and
// must produce exactly the expected findings, status, follow-ups, watched items,
// records, day notes, cardio and main lifts, and the brief must carry the day notes as
// expected. Cardio is never a main lift or a working set. The next-session advice code writes
// (plan.ts) is checked apart: expect.plan lists it where a scenario pins it, and every plan
// must make sense (a bigger weight next, a range that goes up, at most 3 other lifts). No model calls.
//   node lambda/ai-worker/evals/report-v3/check-rules.mjs [--show id]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXERCISES, inputsFor, SCENARIOS } from './scenarios.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/report-v3/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/report-v3/dist/report.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const { analyze, buildPrompt, ageOn, intensityOf, maxHeartRate, moderateEquivalent } = createRequire(import.meta.url)(join(here, 'dist', 'report.cjs'))
const CODE_RULES = new Set(['goal_path', 'next_session', 'pain_hold', 'few_days'])

const show = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1] : null
const CARDIO_TYPES = ['treadmill', 'cardio_level', 'rower', 'cardio_time']
const logTypeOf = new Map(EXERCISES.map((e) => [e.id, e.logType]))
let failed = 0
for (const sc of SCENARIOS) {
    const r = analyze(inputsFor(sc))
    const problems = []
    const ids = r.findings.filter((f) => !CODE_RULES.has(f.rule)).map((f) => f.id)
    if (JSON.stringify(ids) !== JSON.stringify(sc.expect.findings)) problems.push(`findings ${JSON.stringify(ids)}, expected ${JSON.stringify(sc.expect.findings)}`)
    const plan = r.findings.filter((f) => CODE_RULES.has(f.rule))
    if (sc.expect.plan && JSON.stringify(plan.map((f) => f.id)) !== JSON.stringify(sc.expect.plan)) problems.push(`plan ${JSON.stringify(plan.map((f) => f.id))}, expected ${JSON.stringify(sc.expect.plan)}`)
    for (const [id, want] of Object.entries(sc.expect.data ?? {})) {
        const f = r.findings.find((x) => x.id === id)
        if (!f) problems.push(`no finding ${id}`)
        else for (const [k, v] of Object.entries(want)) if (f.data[k] !== v) problems.push(`${id}: ${k} ${JSON.stringify(f.data[k])}, expected ${JSON.stringify(v)}`)
    }
    for (const [id, want] of Object.entries(sc.expect.planData ?? {})) {
        const f = plan.find((x) => x.id === id)
        if (!f) problems.push(`no plan ${id}`)
        else for (const [k, v] of Object.entries(want)) if (f.data[k] !== v) problems.push(`${id}: ${k} ${JSON.stringify(f.data[k])}, expected ${JSON.stringify(v)}`)
    }
    // Every plan makes sense: the next weight is heavier, the range goes up, the other lifts are main
    // lifts no rule speaks to. A lighter week instead: only with a deload, every main lift but a held
    // one, lighter or the same, fewer sets or one, and nothing else that adds weight
    const lighter = plan.filter((f) => f.data.how === 'deload')
    const deloadFired = r.findings.some((f) => f.rule === 'deload')
    const next = plan.filter((f) => f.rule === 'next_session' && f.data.how !== 'deload')
    if (next.length > 3) problems.push(`${next.length} other lifts planned, at most 3`)
    if (deloadFired) {
        const held = new Set(plan.filter((f) => f.rule === 'pain_hold').map((f) => f.subject))
        const want = r.facts.lifts.map((l) => l.exerciseId).filter((id) => !held.has(id))
        if (JSON.stringify(lighter.map((f) => f.subject).sort()) !== JSON.stringify([...want].sort())) problems.push(`lighter week for ${JSON.stringify(lighter.map((f) => f.subject))}, expected every main lift ${JSON.stringify(want)}`)
        if (plan.some((f) => f.rule === 'goal_path' || (f.rule === 'next_session' && f.data.how !== 'deload'))) problems.push('a plan to add weight in a lighter week')
        if (r.findings.some((f) => f.rule === 'low_volume' || f.rule === 'lift_stalled')) problems.push('sets or reps added in a lighter week')
    } else if (lighter.length) problems.push('a lighter week without a deload')
    const spoken = new Set(r.findings.filter((f) => f.rule === 'lift_stalled' || f.rule === 'lift_regressed').map((f) => f.subject))
    for (const f of lighter) {
        const d = f.data
        if (!(d.weightKg <= d.usualKg) || !(d.sets <= d.usualSets) || !(d.sets < d.usualSets || d.usualSets === 1)) problems.push(`${f.id}: ${d.weightKg} kg x ${d.sets} sets is no lighter than ${d.usualKg} kg x ${d.usualSets}`)
    }
    for (const f of plan.filter((x) => x.data.how !== 'deload')) {
        const d = f.data
        if ((d.how === 'load' || d.how === 'load_now') && !(d.nextKg > d.weightKg)) problems.push(`${f.id}: next ${d.nextKg} kg is not above ${d.weightKg} kg`)
        if (d.low != null && d.top != null && !(d.top > d.low || d.how === 'load_now')) problems.push(`${f.id}: range ${d.low}-${d.top}`)
        if (f.rule === 'next_session' && (!r.facts.lifts.some((l) => l.exerciseId === f.subject) || spoken.has(f.subject))) problems.push(`${f.id}: not a main lift no rule speaks to`)
    }
    if (r.facts.status !== sc.expect.status) problems.push(`status ${r.facts.status}, expected ${sc.expect.status}`)
    const watched = r.watching.map((w) => `${w.rule}:${w.subject ?? '-'}`)
    for (const w of sc.expect.watching ?? []) if (!watched.includes(w)) problems.push(`not watching ${w} (watching ${JSON.stringify(watched)})`)
    for (const [id, status] of Object.entries(sc.expect.followUps ?? {})) {
        const f = r.followUps.find((x) => x.id === id)
        if (f?.status !== status) problems.push(`follow-up ${id}: ${f?.status ?? 'missing'}, expected ${status}`)
    }
    const records = r.facts.records.map((x) => x.exerciseId)
    for (const id of sc.expect.records ?? []) if (!records.includes(id)) problems.push(`no record for ${id} (records ${JSON.stringify(records)})`)
    if (sc.expect.records && !sc.expect.records.length && records.length) problems.push(`records ${JSON.stringify(records)}, expected none`)
    // Cardio is a fact of its own: never a main lift, never a working set
    const inputs0 = inputsFor(sc)
    for (const l of r.facts.lifts) if (!['weight_reps', 'bodyweight', 'assisted'].includes(logTypeOf.get(l.exerciseId))) problems.push(`main lift ${l.exerciseId} is logged as ${logTypeOf.get(l.exerciseId)}`)
    const working = inputs0.sets.filter((x) => x.date >= inputs0.periodStart && !CARDIO_TYPES.includes(logTypeOf.get(x.exerciseId))).length
    if (r.facts.totalSets.now !== working) problems.push(`totalSets ${r.facts.totalSets.now}, expected ${working} working sets`)
    if (sc.expect.cardio) {
        const c = r.facts.cardio
        // By heart rate: the minutes by intensity, and each setting's first and latest heart rate
        const trend = (x) => `${x.name} ${x.level != null ? `L${x.level}` : `${x.speedKmh}/${x.inclinePct}`} ${x.first.avgHr}>${x.last.avgHr} x${x.sessions}`
        const got = {
            minutes: c.minutes, days: c.days, legSessions: c.legSessions.length,
            ...c.intensity,
            trends: (c.trends ?? []).map(trend).sort().join('; '),
        }
        for (const [k, v] of Object.entries(sc.expect.cardio)) if (got[k] !== v) problems.push(`cardio ${k} ${got[k]}, expected ${v}`)
    }
    for (const [id, want] of Object.entries(sc.expect.lifts ?? {})) {
        const l = r.facts.lifts.find((x) => x.exerciseId === id)
        if (!l) problems.push(`${id} is not a main lift`)
        else for (const [k, v] of Object.entries(want)) if (l[k] !== v) problems.push(`${id}: ${k} ${JSON.stringify(l[k])}, expected ${JSON.stringify(v)}`)
    }

    // The sets a low-volume finding says to add are the fewest that reach 10 a week, but at most 2 a week
    const perWeek = (sets) => (sets * 7) / r.facts.period.days
    const cap = Math.ceil((2 * r.facts.period.days) / 7)
    for (const f of r.findings.filter((x) => x.rule === 'low_volume')) {
        const { sets, addSets } = f.data
        const fewest = perWeek(sets + addSets) >= 10 && perWeek(sets + addSets - 1) < 10
        if (!(addSets === cap ? perWeek(sets + addSets - 1) < 10 : fewest && addSets < cap)) problems.push(`${f.id}: addSets ${addSets} with ${sets} sets in ${r.facts.period.days} days`)
    }

    // Options: an exercise the user does that trains the muscle, and a staple they don't do yet
    const inputs = inputsFor(sc)
    const theirs = new Set([...inputs.sets.map((s) => s.exerciseId), ...(inputs.schedule ?? []).flatMap((d) => d.plan.map((p) => p.exerciseId))])
    for (const f of r.findings.filter((x) => x.rule === 'low_volume')) {
        const d = f.data
        if (d.addTo == null && d.newExercise == null) problems.push(`${f.id}: no option to offer`)
        if (d.addToId != null && !theirs.has(d.addToId)) problems.push(`${f.id}: addTo ${d.addTo} is not an exercise the user does`)
        if (d.newExerciseId != null && theirs.has(d.newExerciseId)) problems.push(`${f.id}: newExercise ${d.newExercise} is one the user already does`)
        const want = sc.expect.options?.[f.id]
        if (!want) continue
        const got = { ...d, addTo: d.addToId }
        for (const [k, v] of Object.entries(want)) if (got[k] !== v) problems.push(`${f.id}: ${k} ${JSON.stringify(got[k])}, expected ${JSON.stringify(v)}`)
    }

    // Day notes: every note comes through, on its own day, with that day's plan and whether it was trained
    const notes = Object.values(sc.dayNotes ?? {})
    if (JSON.stringify(r.dayNotes.map((d) => d.note)) !== JSON.stringify(notes)) problems.push(`day notes ${JSON.stringify(r.dayNotes.map((d) => d.note))}, expected ${JSON.stringify(notes)}`)
    if (sc.expect.dayNotes) {
        const days = r.dayNotes.map(({ date, routine, trained }) => ({ date, routine, trained }))
        if (JSON.stringify(days) !== JSON.stringify(sc.expect.dayNotes)) problems.push(`day notes lined up as ${JSON.stringify(days)}, expected ${JSON.stringify(sc.expect.dayNotes)}`)
    }
    const brief = buildPrompt({ ...r, note: sc.note ?? null, language: sc.language, weightUnit: sc.weightUnit ?? 'kg', distanceUnit: sc.distanceUnit ?? 'km' })
    for (const line of sc.expect.brief ?? []) if (!brief.split('\n').includes(line)) problems.push(`the brief has no line ${JSON.stringify(line)}`)
    if (!notes.length && /notes on single days/.test(brief)) problems.push('the brief lists day notes, but there are none')

    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${sc.id}${problems.map((p) => `\n       ${p}`).join('')}`)
    if (show === sc.id) console.log(JSON.stringify({ ...r, facts: { ...r.facts, sessions: { ...r.facts.sessions, days: r.facts.sessions.days.length } } }, null, 1))
}
// Without a training cycle there is no plan to line a note up with: the brief says only whether the day was trained
{
    const sc = SCENARIOS.find((x) => x.id === 'bench-pain-day-note-en')
    const r = analyze(inputsFor({ ...sc, cycle: false }))
    const brief = buildPrompt({ ...r, note: null, language: sc.language, weightUnit: 'kg' })
    const want = `- 2026-10-01 (trained): ${JSON.stringify(sc.dayNotes[3])}`
    const ok = brief.split('\n').includes(want)
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} day notes without a cycle${ok ? '' : `\n       the brief has no line ${JSON.stringify(want)}`}`)
}
// Sets logged before their exercise had a log type have only reps x weight: an old treadmill set
// adds no minutes, an old assisted set without its assist doesn't count for the lift
{
    const sc = SCENARIOS.find((x) => x.id === 'assisted-pullup-progress-zh')
    const inputs = inputsFor({ ...sc, routines: { ...sc.routines, legs: [['treadmill', 2], ...sc.routines.legs] } })
    const weekStart = inputs.periodStart
    for (const x of inputs.sets) {
        if (x.date >= weekStart) continue
        if (x.exerciseId === 'ex-treadmill') Object.assign(x, { durationS: null, speedKmh: null, reps: 1, weightKg: 0 })
        if (x.exerciseId === 'ex-assisted' && x.date < '2026-09-14') Object.assign(x, { assistKg: null })
    }
    const r = analyze(inputs)
    const lift = r.facts.lifts.find((l) => l.exerciseId === 'ex-assisted')
    const problems = [
        r.facts.cardio.previousPerWeek !== 0 && `old treadmill sets gave ${r.facts.cardio.previousPerWeek} minutes last week`,
        r.facts.cardio.minutes !== 40 && `cardio ${r.facts.cardio.minutes} minutes, expected 40`,
        !lift?.assisted && 'the assisted pull-up is not read as assisted',
        lift && lift.series.filter((v) => v != null).length !== 3 && `assisted series ${JSON.stringify(lift.series)}: old sets without assist should be left out`,
        lift?.trend !== 'up' && `assisted trend ${lift?.trend}, expected up`,
    ].filter(Boolean)
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} sets logged before log types${problems.map((p) => `\n       ${p}`).join('')}`)
}
// The goal is read as whole words: "again" isn't gain, "clean" isn't lean, "closer" isn't lose, "grow" doesn't name Barbell Row
{
    const sc = { ...SCENARIOS.find((x) => x.id === 'nothing-fires-flat-en'), weights: [80, 79.5, 79, 78.5, 78] }
    const cases = [
        ['Bulk again', 'gain'],
        ['Back to training again after summer', null],
        ['Keep a clean diet and get stronger', null],
        ['Get closer to a muscle-up', null],
        ['Cutting for summer', 'lose'],
        ['grow my back', null],
        // Face Pull's "pull" isn't in "pull-ups"
        ['More pull-ups', null],
    ]
    const problems = []
    for (const [goal, direction] of cases) {
        const r = analyze(inputsFor({ ...sc, goal }))
        if (r.facts.goal.direction !== direction) problems.push(`"${goal}": direction ${r.facts.goal.direction}, expected ${direction}`)
        const weightTrend = r.findings.some((f) => f.rule === 'weight_trend')
        if (weightTrend !== (direction === 'gain')) problems.push(`"${goal}": weight_trend ${weightTrend ? 'fired' : 'did not fire'} with the weight falling`)
        const named = r.facts.lifts.filter((l) => l.goalLift).map((l) => l.exerciseId)
        if (named.length) problems.push(`"${goal}" names ${named.join(', ')}`)
    }
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} goal words${problems.map((p) => `\n       ${p}`).join('')}`)
}
// The body weight change is against the last period with weigh-ins, and says how far back that is
{
    const sc = { ...SCENARIOS.find((x) => x.id === 'nothing-fires-flat-en'), weights: [80, null, 80.5] }
    const r = analyze(inputsFor(sc))
    const brief = buildPrompt({ ...r, note: null, language: sc.language, weightUnit: 'kg' })
    const want = 'Body weight: 80.5 kg (+0.5 kg vs 2 weeks ago), 1 weigh-in(s) this week.'
    const problems = [
        r.facts.bodyWeight.changeWindows !== 2 && `changeWindows ${r.facts.bodyWeight.changeWindows}, expected 2`,
        !brief.split('\n').includes(want) && `the brief has no line ${JSON.stringify(want)}`,
    ].filter(Boolean)
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} body weight change across a gap${problems.map((p) => `\n       ${p}`).join('')}`)
}
// A weighted lift's 0 kg sets have no estimated 1RM: a week of them is not trained, not "up Infinity%" after it
{
    const sc = SCENARIOS.find((x) => x.id === 'all-progress-en')
    const inputs = inputsFor(sc)
    const lastWeek = (d) => d < inputs.periodStart && d >= '2026-09-21'
    for (const x of inputs.sets) if (x.exerciseId === 'ex-bench' && lastWeek(x.date)) x.weightKg = 0
    const bench = analyze(inputs).facts.lifts.find((l) => l.exerciseId === 'ex-bench')
    const problems = [
        !bench && 'the bench is not a main lift',
        bench && !Number.isFinite(bench.change) && `bench change ${bench.change}`,
        bench && bench.series.at(-2) !== null && `last week's 0 kg bench sets count: series ${JSON.stringify(bench.series)}`,
        bench && bench.trend !== 'up' && `bench trend ${bench.trend}, expected up against two weeks ago`,
    ].filter(Boolean)
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} 0 kg sets of a weighted lift${problems.map((p) => `\n       ${p}`).join('')}`)
}
// Heart rate against an estimated maximum (lib/report/cardio-intensity.ts): ACSM's 64% and 77% are
// where moderate and vigorous start, the age turns over on the birthday, and a trend needs this
// period, an earlier one, and sets of 10 minutes or more
{
    const problems = []
    const max = maxHeartRate(30)
    if (max !== 187) problems.push(`max at 30 is ${max}, expected 187 (208 - 0.7 x 30)`)
    const at = (pct) => intensityOf((pct / 100) * 200, 200)
    const cases = [[63.9, 'light'], [64, 'moderate'], [76.9, 'moderate'], [77, 'vigorous'], [98, 'vigorous']]
    for (const [pct, want] of cases) if (at(pct) !== want) problems.push(`${pct}% is ${at(pct)}, expected ${want}`)
    const ages = [['1996-10-02', '2026-10-01', 29], ['1996-10-02', '2026-10-02', 30], ['1996-02-29', '2026-02-28', 29], ['2030-01-01', '2026-10-01', null], ['', '2026-10-01', null], [null, '2026-10-01', null]]
    for (const [born, on, want] of ages) if (ageOn(born, on) !== want) problems.push(`born ${born}, on ${on}: ${ageOn(born, on)}, expected ${want}`)
    if (moderateEquivalent(40, 60) !== 160) problems.push('40 moderate and 60 vigorous minutes should count as 160')
    const base = SCENARIOS.find((x) => x.id === 'cardio-heart-rate-zh')
    const trendsOf = (sc) => analyze(inputsFor(sc)).facts.cardio.trends.length
    // Heart rate only this period: nothing to compare with
    const thisPeriod = trendsOf({ ...base, history: 0 })
    if (thisPeriod) problems.push(`${thisPeriod} trends with no earlier period`)
    // Sets under 10 minutes are mostly the heart rate still rising
    const short = trendsOf({ ...base, progress: { treadmill: base.progress.treadmill.map((x) => x.replace('15min', '9min')), bike: base.progress.bike.map((x) => x.replace('20min', '9min')) } })
    if (short) problems.push(`${short} trends from sets under 10 minutes`)
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} heart rate: intensity by ACSM's cutoffs, age on the birthday, trends only between periods and from 10 minutes${problems.map((p) => `\n       ${p}`).join('')}`)
}
console.log(failed ? `\n${failed} scenario(s) failed` : `\nAll ${SCENARIOS.length} scenarios behave as expected`)
process.exit(failed ? 1 : 0)
