// Free check of today's aim on each exercise (lib/report/progression.ts todayAim): the report's
// plan for the period that ended (its range held from earlier periods), moved on by each session
// since, and what the report decided for
// this period first. Also that Today's numbers are the report's, and that the report plans with
// the same function, so the two can't give different numbers. And the target of an exercise
// outside today's routine (lib/today-workout.ts): another routine's, else last time's sets.
//   npm run check:today-aim
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { planNext, prescribe, todayAim, windowOfFor, type AimFinding } from '../lib/report/progression'
import { aimText, planItems } from '../lib/report/report-text'
import type { ExerciseInfo, Finding, LoggedSet } from '../lib/report/types'
import { loadTodayWorkout, targetOutsideRoutine } from '../lib/today-workout'
import type { SetValues } from '../lib/set-log'

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
// The range is held from period to period, as the report holds it (planNext): set two weeks before
// at 80 x 6-8, reached on every set last week, so the report plans 82.5 and so does Today
{
    const held = [...session(bench, '2026-10-06', [[80, 8], [80, 7], [80, 6]]), ...session(bench, '2026-10-13', [[80, 8], [80, 7], [80, 7]]), ...session(bench, '2026-10-21', [[80, 8], [80, 8], [80, 8]])]
    const a = aimOf(bench, held)
    const rx = planNext(bench, held, 'kg', windowOfFor(LAST.start, LAST.end))!
    check('a range reached last week, set two weeks before: the next weight, as the report plans it',
        same(pick(a, [...NUMBERS, 'fromKg']), { how: 'step_up', weightKg: 82.5, low: 6, top: 8, nextKg: null, fromKg: 80 }) && a!.weightKg === rx.weightKg && a!.low === rx.low && rx.fromKg === 80,
        JSON.stringify({ a, rx }))
    const climbing = [...session(bench, '2026-10-06', [[80, 6], [80, 6], [80, 6]]), ...session(bench, '2026-10-21', [[80, 8], [80, 7], [80, 7]])]
    check('reps climbing inside the range keep it: 80 x 6-8, not 7-9',
        same(pick(aimOf(bench, climbing), NUMBERS), { how: 'load', weightKg: 80, low: 6, top: 8, nextKg: 82.5 }), JSON.stringify(aimOf(bench, climbing)))
}
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
    check('under the exercise, Today says what to do today', aimText(a, 'zh-TW', 'week', 'kg') === '每組做到 8 下' && aimText(a, 'en', 'week', 'kg') === '8 reps on every set',
        `${aimText(a, 'zh-TW', 'week', 'kg')} | ${aimText(a, 'en', 'week', 'kg')}`)
    const up = aimOf(bench, [...lastWeek, ...session(bench, '2026-10-27', [[80, 8], [80, 8], [80, 8]])])!
    // 135 lb, logged in pounds
    const upLb = aimOf(bench, [...session(bench, '2026-10-21', [[61.235, 8]]), ...session(bench, '2026-10-27', [[61.235, 10]])], { unit: 'lb' })!
    check('a step up says why, with the new weight in the unit it is logged in',
        aimText(up, 'zh-TW', 'week', 'kg') === '上次每組都做到 8 下，今天換 82.5\u00a0kg' && aimText(upLb, 'en', 'week', 'lb') === 'every set reached 10 last time, so 140\u00a0lb today',
        `${aimText(up, 'zh-TW', 'week', 'kg')} | ${aimText(upLb, 'en', 'week', 'lb')}`)
    const hold = aimOf(bench, lastWeek, { findings: [finding('pain_hold', { how: 'load', weightKg: 80, low: 6, top: 8 })] })!
    check('a hold says it for the cycle when there is one', aimText(hold, 'zh-TW', 'cycle', 'kg') === '這輪先不加重，80\u00a0kg × 6 下就好', aimText(hold, 'zh-TW', 'cycle', 'kg'))
    for (const language of ['zh-TW', 'en']) {
        const all = [a, up, hold, aimOf(pushUp, session(pushUp, '2026-10-22', [[0, 12]]))!, aimOf(assisted, session(assisted, '2026-10-21', [[0, 6, 30]]))!,
            aimOf(bench, lastWeek, { findings: [finding('next_session', { how: 'deload', weightKg: 72.5, low: 6, sets: 2, usualSets: 3, usualKg: 80 })] })!,
            aimOf(bench, lastWeek, { findings: [finding('goal_path', { path: 'stalled', dropKg: 72.5 })] })!]
        const texts = all.map((x) => aimText(x, language, 'week', 'kg'))
        check(`every kind of aim has its words in ${language}, with no placeholder left`, texts.every((t) => t.length > 3 && !/[{}]|NaN|undefined/.test(t)), texts.join(' | '))
        // Beside the +, a word about later read as the next set's (owner, 2026-10-25)
        check(`no aim says what comes after today, in ${language}`, texts.every((t) => !/下次|下一次|next time|next session|build back/i.test(t)), texts.join(' | '))
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
    check('the report plans with it', /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/report\/progression'/.test(plan) && plan.includes('planNext('))
    const dashboard = sources.find(({ path }) => path === join('app', '(app)', 'dashboard', 'page.tsx'))?.text ?? ''
    check('Today reads as many periods back as the report, so the held range is the same', dashboard.includes('REPORT_WINDOWS - 1'))
}

// ---------- The target of an exercise outside today's routine ----------
{
    const set = (reps: number, weightKg = 50): SetValues => ({ reps, weightKg, durationS: null, speedKmh: null, inclinePct: null, level: null, distanceM: null, assistKg: null, avgHr: null, inputUnit: null })
    check('another routine\'s target comes first', same(targetOutsideRoutine({ sets: 4, reps: 10 }, [set(8), set(8), set(8)], 'weight_reps'), { sets: 4, reps: 10 }))
    check('else as many sets as last time, at its first set\'s reps', same(targetOutsideRoutine(undefined, [set(8), set(6), set(6)], 'weight_reps'), { sets: 3, reps: 8 }))
    check('a timed or cardio exercise takes the sets alone', same(targetOutsideRoutine(undefined, [set(0), set(0)], 'duration'), { sets: 2, reps: null }))
    check('never done and in no routine: no target', targetOutsideRoutine(undefined, [], 'weight_reps') === null)
}

async function checkTargets() {
    // A stand-in Supabase: each query records its calls and is answered by table and what it asked
    const queries: { table: string; ops: [string, unknown[]][] }[] = []
    const info = (name: string, logType = 'weight_reps') => ({ name, name_zh_tw: null, muscle_group: 'chest', log_type: logType, per_side: false, equipment: 'barbell', primary_muscles: ['chest'] })
    const prev = (exerciseId: string, reps: number[], day = '2026-10-20') => reps.map((r, i) => ({ workout_id: `w-${exerciseId}`, exercise_id: exerciseId, set_number: i + 1, reps: r, weight_kg: 60, duration_s: null, speed_kmh: null, incline_pct: null, level: null, distance_m: null, assist_kg: null, avg_hr: null, input_unit: null, workouts: { performed_at: `${day}T15:00:00Z` } }))
    const answer = (q: { table: string; ops: [string, unknown[]][] }) => {
        const has = (op: string, first?: unknown) => q.ops.some(([k, a]) => k === op && (first === undefined || a[0] === first))
        if (q.table === 'workouts') return { data: {
            id: 'w-today', routine_id: 'r-today',
            workout_planned_exercises: [
                { id: 'p1', exercise_id: 'bench', exercises: info('Bench Press') },
                { id: 'p2', exercise_id: 'fly', exercises: info('Cable Fly') },
                { id: 'p3', exercise_id: 'dip', exercises: info('Dip') },
                { id: 'p4', exercise_id: 'plank', exercises: info('Plank', 'duration') },
                { id: 'p5', exercise_id: 'new', exercises: info('Never Done') },
            ],
            workout_sets: [],
            routines: { routine_exercises: [{ exercise_id: 'bench', target_sets: 3, target_reps: 5 }] },
        }, error: null }
        if (q.table === 'routine_exercises' && has('eq', 'routine_id')) return { data: [{ exercise_id: 'bench', target_sets: 3, target_reps: 5, exercises: info('Bench Press') }], error: null }
        if (q.table === 'routine_exercises') return { data: [
            { exercise_id: 'fly', target_sets: 2, target_reps: 15, routines: { created_at: '2026-09-01T00:00:00Z' } },
            { exercise_id: 'fly', target_sets: 4, target_reps: 12, routines: { created_at: '2026-10-01T00:00:00Z' } },
        ], error: null }
        if (q.table === 'workout_sets' && has('gte')) return { data: [], error: null }
        if (q.table === 'workout_sets') return { data: [...prev('fly', [10, 10]), ...prev('dip', [8, 7, 7]), ...prev('plank', [0, 0])], error: null }
        return { data: [], error: null }
    }
    const supabase = {
        from(table: string) {
            const q = { table, ops: [] as [string, unknown[]][] }
            queries.push(q)
            const builder: unknown = new Proxy({}, {
                get(_, key: string) {
                    if (key === 'then') return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve().then(() => answer(q)).then(resolve, reject)
                    return (...args: unknown[]) => { q.ops.push([key, args]); return builder }
                },
            })
            return builder
        },
    } as unknown as Parameters<typeof loadTodayWorkout>[0]
    const today = await loadTodayWorkout(supabase, {
        userId: 'u1', range: { start: '2026-10-27T04:00:00Z', end: '2026-10-28T03:59:59Z' }, routineId: 'r-today', routineExerciseIds: ['bench'], language: 'en', recentFrom: null,
    })
    const targetOf = (id: string) => today.exercises.find((ex) => ex.exerciseId === id)?.target ?? null
    check("today's routine keeps its own target", same(targetOf('bench'), { sets: 3, reps: 5 }))
    check('one added from another routine takes that routine\'s, the newest one\'s', same(targetOf('fly'), { sets: 4, reps: 12 }), JSON.stringify(targetOf('fly')))
    check('one in no routine takes last time\'s sets and reps', same(targetOf('dip'), { sets: 3, reps: 8 }), JSON.stringify(targetOf('dip')))
    check('a timed one takes last time\'s sets', same(targetOf('plank'), { sets: 2, reps: null }), JSON.stringify(targetOf('plank')))
    check('one never done has none', targetOf('new') === null)
    const reloaded = await loadTodayWorkout(supabase, {
        userId: 'u1', range: { start: '2026-10-27T04:00:00Z', end: '2026-10-28T03:59:59Z' }, routineId: 'r-today', language: 'en', recentFrom: null,
    })
    check('reloaded without the routine\'s exercises (after Ronnie changes the day), every target is the same',
        same(reloaded.exercises.map((ex) => ex.target), today.exercises.map((ex) => ex.target)), JSON.stringify(reloaded.exercises.map((ex) => ex.target)))
    queries.length = 0
    await loadTodayWorkout(supabase, {
        userId: 'u1', range: { start: '2026-10-27T04:00:00Z', end: '2026-10-28T03:59:59Z' }, routineId: 'r-today', routineExerciseIds: ['bench'], language: 'en', recentFrom: null,
    })
    const routineRead = queries.filter((q) => q.table === 'routine_exercises' && !q.ops.some(([k, a]) => k === 'eq' && a[0] === 'routine_id'))
    const ids = routineRead[0]?.ops.find(([k]) => k === 'in')?.[1][1] as string[] | undefined
    check("the other routines are read once, for the user's own, only for what today's routine doesn't cover",
        routineRead.length === 1 && routineRead[0].ops.some(([k, a]) => k === 'eq' && a[0] === 'routines.user_id' && a[1] === 'u1') && !!ids && !ids.includes('bench'), JSON.stringify(routineRead.map((q) => q.ops)))
}

checkTargets().then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall passed')
    process.exit(failed ? 1 : 0)
})
