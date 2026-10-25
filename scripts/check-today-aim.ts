// Free check of today's aim on each exercise (lib/report/progression.ts todayAim): the report's
// plan for the period that ended, moved on by each session since, and what the report decided for
// this period first. Also that Today's numbers are the report's, and that the report plans with
// the same function, so the two can't give different numbers.
//   npm run check:today-aim
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prescribe, todayAim, type AimFinding } from '../lib/report/progression'
import { aimText, planItems } from '../lib/report/report-text'
import type { ExerciseInfo, Finding, LoggedSet } from '../lib/report/types'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const pick = (a: object | null, keys: string[]) => (a ? Object.fromEntries(keys.map((k) => [k, (a as Record<string, unknown>)[k]])) : null)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const ex = (id: string, name: string, more: Partial<ExerciseInfo> = {}): ExerciseInfo => ({
    id, name, nameZh: null, muscleGroup: 'chest', primaryMuscles: ['chest'], secondaryMuscles: [], logType: 'weight_reps', equipment: 'barbell', ...more,
})
const bench = ex('bench', 'Barbell Bench Press')
const squat = ex('squat', 'Barbell Back Squat', { muscleGroup: 'legs', primaryMuscles: ['quads', 'glutes'] })
const curl = ex('curl', 'Dumbbell Curl', { muscleGroup: 'arms', primaryMuscles: ['biceps'], equipment: 'dumbbell' })
const pushUp = ex('push', 'Push-Up', { logType: 'bodyweight', equipment: 'bodyweight' })
const assisted = ex('apu', 'Assisted Pull-Up', { muscleGroup: 'back', primaryMuscles: ['lats'], logType: 'assisted', equipment: 'machine' })

let n = 0
/** One session's sets: [weightKg, reps] each, or [weightKg, reps, assistKg] */
const session = (e: ExerciseInfo, date: string, sets: [number, number, number?][]): LoggedSet[] => {
    const workoutId = `w${++n}`
    return sets.map(([weightKg, reps, assistKg], i) => ({
        date, workoutId, exerciseId: e.id, reps, weightKg, assistKg: assistKg ?? null, durationS: null, speedKmh: null, distanceM: null,
        loggedAt: `${date}T10:${String(i).padStart(2, '0')}:00Z`,
    }))
}
// The week the newest report is of; today is the Thursday after it
const LAST = { start: '2026-10-19', end: '2026-10-25' }
const TODAY = '2026-10-29'
const aimOf = (e: ExerciseInfo, sets: LoggedSet[], { unit = 'kg' as 'kg' | 'lb', findings = [] as AimFinding[], lastPeriod = LAST as typeof LAST | null } = {}) =>
    todayAim({ exercise: e, sets, unit, today: TODAY, lastPeriod, findings })
const NUMBERS = ['how', 'weightKg', 'low', 'top', 'nextKg']

// ---------- From the report's plan ----------
const lastWeek = [...session(bench, '2026-10-20', [[80, 8], [80, 7], [80, 6]]), ...session(bench, '2026-10-23', [[75, 10]])]
{
    const a = aimOf(bench, lastWeek)
    const rx = prescribe(bench, lastWeek, 'kg', (d) => (d >= LAST.start && d <= LAST.end ? 0 : 1))!
    check('with no session since, the aim is the report\'s plan: the heaviest weight, the fewest reps up to two more, then the step',
        same(pick(a, NUMBERS), { how: 'load', weightKg: 80, low: 6, top: 8, nextKg: 82.5 }) && a!.weightKg === rx.weightKg && a!.low === rx.low && a!.top === rx.top && a!.nextKg === rx.nextKg,
        JSON.stringify(a))
}
check('a session since that didn\'t reach the top on every set keeps the weight',
    same(pick(aimOf(bench, [...lastWeek, ...session(bench, '2026-10-27', [[80, 8], [80, 8], [80, 7]])]), NUMBERS), { how: 'load', weightKg: 80, low: 6, top: 8, nextKg: 82.5 }))
check('one that reached it on every set steps up, and starts the heavier weight at the bottom of the range',
    same(pick(aimOf(bench, [...lastWeek, ...session(bench, '2026-10-27', [[80, 8], [80, 8], [80, 9]])]), [...NUMBERS, 'fromKg']), { how: 'step_up', weightKg: 82.5, low: 6, top: 8, nextKg: null, fromKg: 80 }))
// A 2 kg step on 12 kg is more than a tenth of it, so the dumbbell's range is four reps wide (the report's rule)
check('the step is the report\'s: 5 kg on a lower-body lift, 2 kg on dumbbells, 5 lb in pounds',
    aimOf(squat, [...session(squat, '2026-10-21', [[100, 6]]), ...session(squat, '2026-10-27', [[100, 8], [100, 8]])])?.weightKg === 105
    && aimOf(curl, [...session(curl, '2026-10-21', [[12, 10]]), ...session(curl, '2026-10-27', [[12, 14]])])?.weightKg === 14
    && Math.abs(aimOf(bench, [...session(bench, '2026-10-21', [[61.235, 8]]), ...session(bench, '2026-10-27', [[61.235, 10]])], { unit: 'lb' })!.weightKg! - 63.503) < 0.01)
check('after a step up, the heavier weight is kept until it reaches the top too',
    same(pick(aimOf(bench, [...lastWeek, ...session(bench, '2026-10-26', [[80, 8], [80, 8], [80, 8]]), ...session(bench, '2026-10-28', [[82.5, 7], [82.5, 6]])]), NUMBERS),
        { how: 'load', weightKg: 82.5, low: 6, top: 8, nextKg: 85 }))
check('15 reps at the heaviest weight goes straight to the next step',
    same(pick(aimOf(bench, session(bench, '2026-10-22', [[40, 15], [40, 16]])), NUMBERS), { how: 'step_up', weightKg: 42.5, low: 15, top: 15, nextKg: null }))
check('today\'s own sets don\'t move today\'s aim', aimOf(bench, [...lastWeek, ...session(bench, TODAY, [[80, 8], [80, 8], [80, 8]])])?.how === 'load')

// ---------- Bodyweight and assisted ----------
check('a bodyweight lift aims at its range, which moves with each session',
    same(pick(aimOf(pushUp, session(pushUp, '2026-10-22', [[0, 12], [0, 10]])), ['how', 'low', 'top']), { how: 'reps', low: 10, top: 12 })
    && same(pick(aimOf(pushUp, [...session(pushUp, '2026-10-22', [[0, 12], [0, 10]]), ...session(pushUp, '2026-10-27', [[0, 13], [0, 12]])]), ['how', 'low', 'top']), { how: 'reps', low: 12, top: 14 }))
check('an assisted lift takes one step less assist once every set reaches the top',
    aimOf(assisted, session(assisted, '2026-10-21', [[0, 6, 30], [0, 5, 30]]))?.how === 'assist'
    && same(pick(aimOf(assisted, [...session(assisted, '2026-10-21', [[0, 6, 30], [0, 5, 30]]), ...session(assisted, '2026-10-27', [[0, 7, 30], [0, 7, 30]])]), ['how', 'assistKg', 'top']), { how: 'assist_down', assistKg: 30, top: 7 }))

// ---------- What the report decided for this period ----------
function finding(rule: string, data: Record<string, unknown>, subject = 'bench'): AimFinding {
    return { rule, subject, data }
}
{
    const pain = aimOf(bench, [...lastWeek, ...session(bench, '2026-10-27', [[80, 8], [80, 8], [80, 8]])], { findings: [finding('pain_hold', { how: 'load', weightKg: 80, low: 6, top: 8 })] })
    check('a lift the report holds for pain is held, even after every set reached the top', same(pick(pain, ['how', 'weightKg', 'low', 'nextKg']), { how: 'hold', weightKg: 80, low: 6, nextKg: null }), JSON.stringify(pain))
    const deload = aimOf(bench, lastWeek, { findings: [finding('next_session', { how: 'deload', weightKg: 72.5, low: 6, sets: 2, usualSets: 3, usualKg: 80, assistKg: null })] })
    check('a lighter week is the report\'s numbers for it', same(pick(deload, ['how', 'weightKg', 'low', 'sets', 'usualSets', 'usualKg']), { how: 'lighter', weightKg: 72.5, low: 6, sets: 2, usualSets: 3, usualKg: 80 }), JSON.stringify(deload))
    const stalled = [finding('goal_path', { path: 'stalled', dropKg: 72.5, weightKg: 80, low: 6, top: 8 })]
    check('a goal lift the report takes down starts from the lower weight', same(pick(aimOf(bench, lastWeek, { findings: stalled }), [...NUMBERS, 'fromKg']), { how: 'reset', weightKg: 72.5, low: 6, top: 8, nextKg: 75, fromKg: 80 }))
    check('and moves on from it after a session there', same(pick(aimOf(bench, [...lastWeek, ...session(bench, '2026-10-27', [[72.5, 8], [72.5, 8], [72.5, 8]])], { findings: stalled }), NUMBERS), { how: 'step_up', weightKg: 75, low: 6, top: 8, nextKg: null }))
    check('another lift\'s finding changes nothing here', aimOf(bench, lastWeek, { findings: [finding('pain_hold', { weightKg: 50, low: 5 }, 'squat')] })?.how === 'load')
}

// ---------- Nothing to go on ----------
check('in a cycle\'s first round, the latest session gives the range, and doesn\'t step up on itself',
    same(pick(aimOf(bench, session(bench, '2026-10-27', [[60, 10], [60, 10]]), { lastPeriod: null }), NUMBERS), { how: 'load', weightKg: 60, low: 10, top: 12, nextKg: 62.5 }))
check('no aim for an exercise not done lately, cardio, a timed hold or a core exercise',
    aimOf(bench, []) === null
    && aimOf(ex('run', 'Treadmill', { muscleGroup: 'cardio', logType: 'treadmill' }), session(ex('run', 'Treadmill'), '2026-10-22', [[0, 0]])) === null
    && aimOf(ex('plank', 'Plank', { muscleGroup: 'core', logType: 'duration' }), []) === null
    && aimOf(ex('crunch', 'Crunch', { muscleGroup: 'core', logType: 'bodyweight' }), session(ex('crunch', 'Crunch'), '2026-10-22', [[0, 20]])) === null)

// ---------- In the report's words ----------
{
    const rx = prescribe(bench, lastWeek, 'kg', (d) => (d >= LAST.start && d <= LAST.end ? 0 : 1))!
    const reportLine = (language: string) => {
        const f: Finding = { id: 'next_session:bench', rule: 'next_session', subject: 'bench', priority: 55, data: { name: 'Barbell Bench Press', nameZh: '槓鈴臥推', how: rx.how, weightKg: rx.weightKg, low: rx.low, top: rx.top, nextKg: rx.nextKg, assistKg: rx.assistKg, sets: rx.sets } }
        return planItems([f], language, 'week', 'kg')[0].lines![0].text
    }
    const a = aimOf(bench, lastWeek)!
    const line = reportLine('zh-TW')
    check('the report\'s line for the same lift has Today\'s numbers: the weight, the range and the next weight',
        line.includes('80 kg') && line.includes(`${a.low}–${a.top}`) && line.includes('82.5 kg') && a.weightKg === 80 && a.nextKg === 82.5, `${line} | ${JSON.stringify(a)}`)
    check('under the exercise, Today says how the aim moves on: the next weight is for the next session, not the next set', aimText(a, 'zh-TW', 'week', 'kg') === '每組都做到 8 下，下次練再換 82.5 kg' && aimText(a, 'en', 'week', 'kg') === 'at 8 on every set, 82.5 kg next session',
        `${aimText(a, 'zh-TW', 'week', 'kg')} | ${aimText(a, 'en', 'week', 'kg')}`)
    const up = aimOf(bench, [...lastWeek, ...session(bench, '2026-10-27', [[80, 8], [80, 8], [80, 8]])])!
    // 135 lb, logged in pounds
    const upLb = aimOf(bench, [...session(bench, '2026-10-21', [[61.235, 8]]), ...session(bench, '2026-10-27', [[61.235, 10]])], { unit: 'lb' })!
    check('a step up says why, with the new weight in the unit it is logged in',
        aimText(up, 'zh-TW', 'week', 'kg') === '上次每組都做到 8 下，所以換 82.5 kg' && aimText(upLb, 'en', 'week', 'lb') === 'every set reached 10 last time, so 140 lb',
        `${aimText(up, 'zh-TW', 'week', 'kg')} | ${aimText(upLb, 'en', 'week', 'lb')}`)
    const hold = aimOf(bench, lastWeek, { findings: [finding('pain_hold', { how: 'load', weightKg: 80, low: 6, top: 8 })] })!
    check('a hold says it for the cycle when there is one', aimText(hold, 'zh-TW', 'cycle', 'kg') === '這輪先不加重，80 kg × 6 下就好', aimText(hold, 'zh-TW', 'cycle', 'kg'))
    for (const language of ['zh-TW', 'en']) {
        const all = [a, up, hold, aimOf(pushUp, session(pushUp, '2026-10-22', [[0, 12]]))!, aimOf(assisted, session(assisted, '2026-10-21', [[0, 6, 30]]))!,
            aimOf(bench, lastWeek, { findings: [finding('next_session', { how: 'deload', weightKg: 72.5, low: 6, sets: 2, usualSets: 3, usualKg: 80 })] })!,
            aimOf(bench, lastWeek, { findings: [finding('goal_path', { path: 'stalled', dropKg: 72.5 })] })!]
        const texts = all.map((x) => aimText(x, language, 'week', 'kg'))
        check(`every kind of aim has its words in ${language}, with no placeholder left`, texts.every((t) => t.length > 3 && !/[{}]|NaN|undefined/.test(t)), texts.join(' | '))
    }
}

// ---------- One function for the report and Today ----------
{
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' || name.startsWith('preview-') ? [] : walk(path)
        return /\.tsx?$/.test(name) ? [path] : []
    })
    const sources = ['app', 'components', 'lib', 'lambda/ai-worker/src'].flatMap(walk).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    const own = join('lib', 'report', 'progression.ts')
    const copies = sources.filter(({ path, text }) => path !== own && /function prescribe\(|const STEP = \{|function todayAim\(/.test(text)).map(({ path }) => path)
    check('the next session is worked out only in lib/report/progression.ts', copies.length === 0, copies.join(', '))
    const plan = sources.find(({ path }) => path === join('lambda', 'ai-worker', 'src', 'report', 'plan.ts'))?.text ?? ''
    check('the report plans with it', /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/report\/progression'/.test(plan) && plan.includes('prescribe('))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
