// Training scenarios for the v3 report, each with planted signals and what the
// code must find. check-rules.mjs runs them through analyze() for free; the paid
// eval (run-eval.mjs) gives the same inputs to the model.
//
// A scenario describes a repeating week (or cycle) of routines. Every set of an
// exercise in a window is logged at that window's weight x reps, oldest window
// first in `progress`: '80x8' is 80 kg x 8, 'a30x8' 8 reps with 30 kg of assist, '10min' a
// cardio set of 10 minutes (the treadmill at 10 km/h). Sets are logged in the routine's order.
// Window 0 is the reported period. `note` is the note for the whole period; `dayNotes` maps a
// day of the period (its index in `plan`) to that day's note.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const LIBRARY = [
    ['bench', 'Barbell Bench Press', '槓鈴臥推', 'chest'],
    ['incline', 'Incline Dumbbell Press', '上斜啞鈴臥推', 'chest'],
    ['ohp', 'Overhead Press', '肩推', 'shoulders'],
    ['lateral', 'Lateral Raise', '側平舉', 'shoulders'],
    ['pushdown', 'Triceps Pushdown', '三頭下壓', 'triceps'],
    ['dips', 'Dips', '雙槓撐體', 'triceps'],
    ['pullup', 'Pull-up', '引體向上', 'back'],
    ['row', 'Barbell Row', '槓鈴划船', 'back'],
    ['pulldown', 'Lat Pulldown', '滑輪下拉', 'back'],
    ['curl', 'Barbell Curl', '槓鈴彎舉', 'biceps'],
    ['facepull', 'Face Pull', '臉拉', 'shoulders'],
    ['squat', 'Barbell Back Squat', '深蹲', 'legs'],
    ['rdl', 'Romanian Deadlift', '羅馬尼亞硬舉', 'legs'],
    ['legpress', 'Leg Press', '腿推機', 'legs'],
    ['legcurl', 'Seated Leg Curl', '坐姿腿彎舉機', 'legs'],
    ['hipthrust', 'Hip Thrust', '臀推', 'glutes'],
    ['plank', 'Plank', '棒式', 'core'],
    ['assisted', 'Assisted Pull-up', '輔助引體向上', 'back'],
    ['treadmill', 'Treadmill', '跑步機', 'cardio'],
    ['bike', 'Stationary Bike', '健身車', 'cardio'],
]
// Each takes the reviewed muscles of its counterpart in the real library
const ATTRIBUTES = createRequire(import.meta.url)('../../../../supabase/data/exercise-attributes.json')
const LIBRARY_NAME = { 'Incline Dumbbell Press': 'Incline Dumbbell Bench Press', Dips: 'Triceps Dip' }
// Equipment lives in the database; the search eval's copy of the library has it
const EQUIPMENT = new Map(readFileSync(new URL('../../../../evals/search/library.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).map((c) => [c[1], c[4] || null]))
function musclesOf(name) {
    const real = LIBRARY_NAME[name] ?? name
    const a = ATTRIBUTES.find((x) => x.name === real)
    if (!a) throw new Error(`scenario exercise ${name} has no counterpart in exercise-attributes.json`)
    return { primaryMuscles: a.primary, secondaryMuscles: a.secondary, logType: a.logType, jointLoad: a.jointLoad, equipment: EQUIPMENT.get(real) ?? null }
}
// The rest of the library, untrained, as the report sees it: a low muscle's advice may suggest one of its staples
const IN_SCENARIOS = new Set(LIBRARY.map(([, name]) => LIBRARY_NAME[name] ?? name))
export const EXERCISES = [
    ...LIBRARY.map(([key, name, nameZh, muscleGroup]) => ({ id: `ex-${key}`, name, nameZh, muscleGroup, ...musclesOf(name) })),
    ...ATTRIBUTES.filter((a) => !IN_SCENARIOS.has(a.name))
        .map((a) => ({ id: a.id, name: a.name, nameZh: a.nameZh, muscleGroup: a.muscleGroup, primaryMuscles: a.primary, secondaryMuscles: a.secondary, logType: a.logType, jointLoad: a.jointLoad, equipment: EQUIPMENT.get(a.name) ?? null })),
]
const CARDIO = new Set(EXERCISES.filter((e) => ['treadmill', 'cardio_level', 'rower', 'cardio_time'].includes(e.logType)).map((e) => e.id))

// Compound lifts get 4 sets, accessories fewer, as most programs do. Trained twice a week it
// puts every muscle with a range at 10 or more (a secondary muscle counting half): side and
// rear delts 10, quads 14, hamstrings 12; back and glutes go over 20, which is no rule. So a
// scenario's own signal is the only thing that fires.
const PPL = {
    push: [['bench', 4], ['ohp', 4], ['incline', 3], ['lateral', 3], ['pushdown', 2]],
    pull: [['row', 4], ['pulldown', 3], ['facepull', 3], ['curl', 3]],
    legs: [['squat', 4], ['rdl', 4], ['legpress', 3], ['legcurl', 2]],
}
const DEFAULTS = {
    bench: '80x8', incline: '26x10', ohp: '45x8', lateral: '10x12', pushdown: '30x12', dips: '0x10', pullup: '0x8',
    row: '70x8', pulldown: '55x10', curl: '30x10', facepull: '15x15', squat: '100x6', rdl: '90x8', legpress: '160x10', legcurl: '40x12', hipthrust: '100x10', plank: '0x60',
    assisted: 'a30x8', treadmill: '10min', bike: '10min',
}

const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
}
/** A set as the report reads it, from '80x8', 'a30x8' or '10min' */
const parse = (s) => {
    const set = { reps: 0, weightKg: 0, durationS: null, speedKmh: null, distanceM: null, assistKg: null }
    const minutes = /^(\d+)min$/.exec(s)
    if (minutes) return { ...set, durationS: Number(minutes[1]) * 60 }
    const [w, r] = s.replace(/^a/, '').split('x').map(Number)
    return s.startsWith('a') ? { ...set, reps: r, assistKg: w } : { ...set, weightKg: w, reps: r }
}
/** Without a `progress` entry, a weighted lift creeps up a little every period, an assisted one needs a little less help; bodyweight ones and cardio stay put. */
function defaultAt(key, k) {
    const set = parse(DEFAULTS[key])
    if (set.assistKg != null) return { ...set, assistKg: set.assistKg + 2.5 * k }
    const step = set.weightKg >= 40 ? 2.5 : set.weightKg >= 15 ? 1 : set.weightKg > 0 ? 0.5 : 0
    return { ...set, weightKg: set.weightKg - step * k }
}

/** Inputs for analyze(), from a scenario. */
export function inputsFor(sc) {
    const days = sc.plan.length
    const periodEnd = addDays(sc.periodStart, days - 1)
    const windows = (sc.history ?? 5) + 1
    const sets = []
    for (let k = 0; k < windows; k++) {
        sc.plan.forEach((routine, i) => {
            if (!routine) return
            if ((k === 0 || sc.skipEveryPeriod) && sc.skip?.includes(i)) return
            const date = addDays(sc.periodStart, i - k * days)
            let order = 0
            for (const [key, n] of sc.routines[routine]) {
                const series = sc.progress?.[key]
                const set = series ? parse(series[series.length - 1 - k] ?? series[0]) : defaultAt(key, k)
                // A treadmill set runs at 10 km/h, so it has a distance
                if (key === 'treadmill' && set.durationS != null) set.speedKmh = 10
                for (let j = 0; j < n; j++) {
                    // Logged in the routine's order, three minutes apart, from 18:00 UTC
                    const loggedAt = new Date(Date.parse(`${date}T18:00:00Z`) + order++ * 180_000).toISOString()
                    sets.push({ date, workoutId: `w-${date}`, exerciseId: `ex-${key}`, ...set, loggedAt })
                }
            }
        })
    }
    const weighIns = []
    ;(sc.weights ?? []).forEach((kg, i, arr) => {
        if (kg == null) return
        const k = arr.length - 1 - i
        weighIns.push({ date: addDays(periodEnd, -k * days), weightKg: kg })
    })
    return {
        periodStart: sc.periodStart,
        periodEnd,
        sets,
        exercises: EXERCISES,
        schedule: sc.cycle ? sc.plan.map((routine, i) => ({
            date: addDays(sc.periodStart, i),
            routine: routine ? sc.routineNames[routine] : null,
            plan: routine ? sc.routines[routine].map(([key, sets]) => ({ exerciseId: `ex-${key}`, sets })) : [],
        })) : null,
        weighIns,
        goal: sc.goal ?? null,
        // The first exercise that isn't cardio, as fetch.ts reads it
        routineLeads: Object.values(sc.routines).map((r) => `ex-${r.find(([key]) => !CARDIO.has(`ex-${key}`))[0]}`),
        previousFindings: sc.previousFindings ?? null,
        notes: Object.entries(sc.dayNotes ?? {}).map(([i, note]) => ({ date: addDays(sc.periodStart, Number(i)), note })),
        // The goal as read, Ronnie's notes and what was said this period, where a scenario gives them;
        // a signal's day is its index in the plan, like a day note's
        ...(sc.goalRead !== undefined ? { goalRead: sc.goalRead } : {}),
        ...(sc.memory ? { memory: sc.memory } : {}),
        ...(sc.signals ? { weekRead: { signals: sc.signals.map(({ day, ...x }) => ({ date: addDays(sc.periodStart, day), ...x })), texts: sc.signals.length, model: 'm' } } : {}),
        weightUnit: sc.weightUnit ?? 'kg',
    }
}

const NAMES_ZH = { push: '推日', pull: '拉日', legs: '腿日' }
const NAMES_EN = { push: 'Push Day', pull: 'Pull Day', legs: 'Leg Day' }
const WEEK = ['push', 'pull', 'legs', 'push', 'legs', 'pull', null]

// expect.findings: exactly these finding ids, highest priority first
// expect.watching: these rule:subject pairs are watched (others may be too)
// expect.followUps: id -> status
// expect.options: finding id -> the low-volume options code must pick (addTo is an exercise id, newExercise a library name)
// expect.dayNotes: each day note's date, planned routine and whether it was trained, as code lines them up
// expect.brief: lines the brief must contain word for word (how the day notes reach the model)
// expect.cardio: this period's cardio minutes, cardio days and lower-body sessions
// expect.lifts: main lift id -> its trend and whether it is read as an assisted lift
// expect.data: finding id -> fields its data must have (undefined: must not have)
export const SCENARIOS = [
    {
        id: 'mockup-week-zh',
        why: '草稿上的那一週：臥推停滯 3 週（目標是臥推）。週五腿日沒練，股四頭和腿後側只剩 7 組和 6 組，但上週都夠，所以算在漏練裡，不另外說訓練量不足（一個原因只說一次）。划船持平 2 週、體重下降 3 週都只是觀察。上週建議肩推衝次數，這週做到了。',
        language: 'zh-TW', goal: '增肌，三個月內臥推 100kg', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL, skip: [4],
        progress: {
            bench: ['77.5x8', '80x8', '82.5x8', '82.5x8', '82.5x8', '82.5x8'],
            squat: ['95x6', '97.5x6', '97.5x6', '100x6', '100x6', '102.5x6'],
            rdl: ['85x8', '87.5x8', '87.5x8', '90x8', '90x8', '92.5x8'],
            ohp: ['45x8', '45x8', '47.5x6', '47.5x6', '47.5x6', '47.5x8'],
            row: ['67.5x8', '70x8', '70x8', '72.5x8', '72.5x8', '72.5x8'],
        },
        weights: [72.6, 72.8, 72.9, 72.8, 72.7, 72.4],
        previousFindings: [{ id: 'lift_stalled:ex-ohp', rule: 'lift_stalled', subject: 'ex-ohp', priority: 60, data: { name: 'Overhead Press', nameZh: '肩推', best: '47.5x6', flatWindows: 3 } }],
        expect: {
            status: 'progressing',
            findings: ['lift_stalled:ex-bench', 'missed_sessions:-'],
            watching: ['lift_stalled:ex-row', 'weight_trend:-'],
            followUps: { 'lift_stalled:ex-ohp': 'done' },
            records: ['ex-squat', 'ex-rdl', 'ex-ohp'],
        },
    },
    {
        id: 'all-progress-en',
        why: 'Every lift goes up and every session was done. Nothing fires, so the report must not invent advice.',
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN, routines: PPL,
        progress: {
            bench: ['70x8', '72.5x8', '75x8', '77.5x8', '80x8', '82.5x8'],
            squat: ['90x6', '92.5x6', '95x6', '97.5x6', '100x6', '102.5x6'],
            rdl: ['80x8', '82.5x8', '85x8', '87.5x8', '90x8', '92.5x8'],
            row: ['60x8', '62.5x8', '65x8', '67.5x8', '70x8', '72.5x8'],
            ohp: ['40x8', '40x9', '42.5x8', '42.5x9', '45x8', '45x9'],
            incline: ['22x10', '22x11', '24x10', '24x11', '26x10', '26x11'],
        },
        weights: [70.0, 70.2, 70.4, 70.5, 70.7, 70.9],
        expect: { status: 'progressing', findings: [], records: ['ex-bench', 'ex-squat', 'ex-rdl', 'ex-row', 'ex-ohp'] },
    },
    {
        id: 'deload-fatigue-zh',
        why: '三個主要動作同時退步 3% 以上，加上備註說很累、關節痠：要建議減量，不是個別動作退步。',
        language: 'zh-TW', goal: '增肌', note: '這週一直很累，膝蓋和手肘有點痠，感覺越練越差',
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL,
        progress: {
            bench: ['75x8', '77.5x8', '80x8', '82.5x8', '85x8', '80x7'],
            squat: ['95x6', '97.5x6', '100x6', '102.5x6', '105x6', '100x5'],
            row: ['65x8', '67.5x8', '70x8', '72.5x8', '75x8', '70x7'],
        },
        expect: { status: 'regressing', findings: ['deload:-'] },
    },
    {
        id: 'goal-lift-regressed-en',
        why: 'Only the goal lift (bench) dropped, by more than 5%, while the other lifts went up. One lift, so not a deload.',
        language: 'en', goal: 'Bench 100 kg by spring', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        progress: { bench: ['80x8', '82.5x8', '85x8', '87.5x8', '90x6', '85x5'] },
        expect: { status: 'progressing', findings: ['lift_regressed:ex-bench'] },
    },
    {
        id: 'first-report-zh',
        why: '第一份報告：沒有之前的資料，狀態是「基準」，不能說停滯或退步。拉日一週只排一次，背、肩後束、二頭的組數都偏低，但沒寫目標：只想記錄的人不給加組建議（擁有者 10/20），只有程式寫的「做滿次數再加重」，用最常練的三個動作。',
        language: 'zh-TW', goal: null, note: null,
        periodStart: '2026-09-28', plan: ['push', 'pull', 'legs', null, 'push', null, 'legs'], cycle: false, routines: { ...PPL, pull: [['row', 3], ['pulldown', 3], ['curl', 3]] }, history: 0,
        expect: {
            status: 'baseline', findings: [], records: [],
            plan: ['next_session:ex-bench', 'next_session:ex-squat', 'next_session:ex-row'],
            planData: { 'next_session:ex-bench': { how: 'load', weightKg: 80, low: 8, top: 10, nextKg: 82.5 }, 'next_session:ex-squat': { weightKg: 100, nextKg: 105 } },
        },
    },
    {
        id: 'cycle-4day-en',
        why: 'A 4-day cycle: sets are scaled to a week. The side delts get only the overhead press, 3 sets counting half, so 1.5 in 4 days, about 2.6 a week, which is low; chest 7 sets in 4 days is about 12 a week, fine, and every other muscle with a range is too.',
        language: 'en', goal: 'Get stronger', note: null,
        periodStart: '2026-10-02', plan: ['push', 'pull', 'legs', null], cycle: true, routineNames: NAMES_EN,
        routines: {
            push: [['bench', 4], ['incline', 3], ['ohp', 3], ['pushdown', 2]],
            pull: [['row', 4], ['pulldown', 3], ['facepull', 4], ['curl', 3]],
            legs: [['squat', 4], ['legpress', 2], ['rdl', 4], ['legcurl', 2]],
        },
        progress: { squat: ['100x5', '102.5x5', '105x5', '107.5x5', '110x5', '112.5x5'] },
        expect: {
            status: 'progressing', findings: ['low_volume:side_delts'], records: ['ex-squat'],
            // At most 2 more a week: 4 more overhead-press sets (half each), or the new exercise
            options: { 'low_volume:side_delts': { addTo: 'ex-ohp', addToSets: 4, addToHalf: 1, newExercise: 'Lateral Raise' } },
        },
    },
    {
        id: 'fat-loss-weight-up-zh',
        why: '目標是減脂，體重已經連續 4 個週期上升：體重規則成立。',
        language: 'zh-TW', goal: '減脂，維持肌肉', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        weights: [80.0, 80.0, 80.3, 80.6, 80.9, 81.3],
        expect: { status: 'progressing', findings: ['weight_trend:-'] },
    },
    {
        id: 'bodyweight-reps-en',
        why: 'Pull-ups and dips are bodyweight: they progress by reps, and a rep record counts as a record.',
        language: 'en', goal: 'More pull-ups', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false,
        routines: {
            push: [['dips', 4], ['bench', 3], ['incline', 2], ['lateral', 5], ['pushdown', 1]],
            pull: [['pullup', 4], ['row', 3], ['facepull', 4], ['curl', 2]],
            legs: [['squat', 4], ['rdl', 3], ['legpress', 3], ['legcurl', 2]],
        },
        progress: { pullup: ['0x6', '0x6', '0x7', '0x7', '0x8', '0x9'], dips: ['0x8', '0x9', '0x10', '0x10', '0x11', '0x12'] },
        expect: { status: 'progressing', findings: [], records: ['ex-pullup', 'ex-dips'] },
    },
    {
        id: 'busy-week-note-zh',
        why: '出差少練兩次：漏練規則成立。胸、肩中束、肩後束、二頭、三頭因此低於 10 組，但上週都夠，算在漏練裡。報告要把備註考慮進去，不能責怪。',
        language: 'zh-TW', goal: '維持體能', note: '這週出差，只練了四次',
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL, skip: [3, 5],
        expect: { status: 'progressing', findings: ['missed_sessions:-'] },
    },
    {
        id: 'nothing-fires-flat-en',
        why: 'Lifts flat for two weeks only: below the stall threshold, so they are watched and the report gives no advice.',
        language: 'en', goal: null, note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        progress: {
            bench: ['75x8', '77.5x8', '80x8', '82.5x8', '82.5x8', '82.5x8'],
            squat: ['90x6', '92.5x6', '95x6', '100x6', '100x6', '100x6'],
        },
        expect: { status: 'progressing', findings: [], watching: ['lift_stalled:ex-bench', 'lift_stalled:ex-squat'] },
    },
    {
        id: 'follow-up-mixed-zh',
        why: '上週三個建議：背的組數補上了（完成）、臥推還是卡住（沒完成）、漏練從兩次變一次（部分完成）。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL, skip: [4],
        progress: { bench: ['77.5x8', '80x8', '82.5x8', '82.5x8', '82.5x8', '82.5x8'] },
        previousFindings: [
            { id: 'low_volume:back', rule: 'low_volume', subject: 'back', priority: 50, data: { sets: 7, perWeek: 7, target: 10 } },
            { id: 'lift_stalled:ex-bench', rule: 'lift_stalled', subject: 'ex-bench', priority: 60, data: { name: 'Barbell Bench Press', nameZh: '槓鈴臥推', best: '82.5x8', flatWindows: 3 } },
            { id: 'missed_sessions:-', rule: 'missed_sessions', subject: null, priority: 40, data: { done: 4, planned: 6, missed: 2 } },
        ],
        expect: {
            status: 'progressing',
            findings: ['lift_stalled:ex-bench', 'missed_sessions:-'],
            followUps: { 'low_volume:back': 'done', 'lift_stalled:ex-bench': 'not_done', 'missed_sessions:-': 'partial' },
            // By name: the model can't name a lift from its id
            brief: ['- low_volume (背): done', '- lift_stalled (槓鈴臥推): not_done', '- missed_sessions: partial'],
        },
    },
    {
        id: 'goal-lift-few-sets-en',
        why: 'The goal names the squat, which has few sets, so it is still a main lift, and its stall ranks first.',
        language: 'en', goal: 'Squat 140 kg', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false,
        routines: {
            push: [['bench', 4], ['incline', 4], ['ohp', 4], ['lateral', 4], ['pushdown', 4]],
            pull: [['row', 4], ['pulldown', 4], ['facepull', 3], ['curl', 4]],
            legs: [['squat', 2], ['legpress', 4], ['rdl', 4], ['legcurl', 2]],
        },
        progress: {
            squat: ['110x5', '112.5x5', '115x5', '115x5', '115x5', '115x5'],
            bench: ['70x8', '72.5x8', '75x8', '77.5x8', '80x8', '82.5x8'],
        },
        // "Squat" names Barbell Back Squat, the only squat the user trains
        expect: { status: 'progressing', findings: ['lift_stalled:ex-squat'], records: ['ex-bench'], lifts: { 'ex-squat': { goalLift: true } } },
    },
    {
        id: 'high-volume-en',
        why: 'Chest gets 26 sets a week: above the range, but that is not a rule. The report must not invent a volume warning.',
        language: 'en', goal: 'Bigger chest', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false,
        routines: {
            push: [['bench', 5], ['incline', 4], ['ohp', 3], ['lateral', 4], ['pushdown', 3]],
            pull: [['row', 4], ['pulldown', 3], ['facepull', 3], ['curl', 3], ['bench', 4]],
            legs: [['squat', 4], ['rdl', 4], ['legpress', 3], ['legcurl', 2]],
        },
        progress: { bench: ['70x8', '72.5x8', '75x8', '77.5x8', '80x8', '82.5x8'] },
        expect: { status: 'progressing', findings: [], records: ['ex-bench'] },
    },
    {
        id: 'many-findings-zh',
        why: '同時有減量、漏練（兩次腿日都沒練）和體重規則：報告最多寫 3 項，而且減量一定要在裡面。',
        language: 'zh-TW', goal: '增肌', note: '最近睡不好',
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL, skip: [2, 4],
        progress: {
            bench: ['75x8', '77.5x8', '80x8', '82.5x8', '85x8', '80x7'],
            row: ['65x8', '67.5x8', '70x8', '72.5x8', '75x8', '70x7'],
            ohp: ['40x8', '42.5x8', '45x8', '45x8', '47.5x8', '45x7'],
        },
        weights: [73.5, 73.3, 73.0, 72.8, 72.5, 72.2],
        expect: { status: 'regressing', findings: ['deload:-', 'missed_sessions:-', 'weight_trend:-'] },
    },
    {
        id: 'two-down-deload-en',
        why: 'Exactly two lifts drop 3-5% (bench 82.5x8 to 80x8, squat 120x5 to 115x5) and none goes up: the smallest deload.',
        language: 'en', goal: null, note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        progress: {
            bench: ['75x8', '77.5x8', '80x8', '80x8', '82.5x8', '80x8'],
            squat: ['105x5', '110x5', '112.5x5', '115x5', '120x5', '115x5'],
            ohp: ['40x8', '42.5x8', '42.5x8', '45x8', '47.5x8', '47.5x8'],
            row: ['62.5x8', '65x8', '67.5x8', '70x8', '72.5x8', '72.5x8'],
            rdl: ['82.5x8', '85x8', '87.5x8', '90x8', '92.5x8', '92.5x8'],
        },
        expect: { status: 'regressing', findings: ['deload:-'] },
    },
    {
        id: 'two-down-others-up-zh',
        why: '同樣兩個動作小幅退步（3-5%），但另外三個在進步：不是全面疲勞，不建議減量；單一動作退步不到 5% 也不另外提醒。',
        language: 'zh-TW', goal: null, note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        progress: {
            bench: ['75x8', '77.5x8', '80x8', '80x8', '82.5x8', '80x8'],
            squat: ['105x5', '110x5', '112.5x5', '115x5', '120x5', '115x5'],
        },
        expect: { status: 'progressing', findings: [] },
    },
    {
        id: 'lb-user-zh',
        why: '用磅記錄的使用者（資料庫存公斤）：臥推卡在 225 磅（102.06 公斤）三週。報告裡所有重量都要用磅，加重幅度也要用磅（上肢 5 磅）。',
        language: 'zh-TW', weightUnit: 'lb', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL,
        progress: { bench: ['97.52x8', '99.79x8', '102.06x8', '102.06x8', '102.06x8', '102.06x8'] },
        weights: [80.29, 80.29, 80.29, 80.29, 80.29, 80.29],
        expect: { status: 'progressing', findings: ['lift_stalled:ex-bench'] },
    },
    {
        id: 'shoulder-pain-note-zh',
        why: '肩中束只有側平舉，每週 4 組，一直偏低：訓練量規則成立（肩前束有推的動作，不設範圍）。但備註說做側平舉右肩會痛，所以建議不能只是多做側平舉，要換不痛的做法。備註不一定要回覆，要的是建議配合它。',
        language: 'zh-TW', goal: '增肌', note: '側平舉的時候右肩會卡卡的，有點痛',
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: { ...PPL, push: [['bench', 4], ['incline', 3], ['lateral', 2], ['pushdown', 2]] },
        expect: { status: 'progressing', findings: ['low_volume:side_delts'] },
    },
    {
        id: 'many-low-note-zh',
        why: '四個部位都不夠：肩中束 8 組、肩後束 6 組、腿後側 2 組、二頭 9 組，每個都有兩個選項。以前這會寫成一大段（擁有者 10/12–10/18 的報告），現在程式把每個部位和選項列成一行，模型只寫一句短的開頭。週二的筆記說做臉拉左肩有點緊：肩後束不能只叫他多做臉拉，要偏向不痛的選項（反向蝴蝶機）或先用輕重量。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: {
            push: [['bench', 4], ['ohp', 4], ['incline', 3], ['lateral', 2], ['pushdown', 2]],
            pull: [['row', 4], ['pulldown', 3], ['facepull', 1], ['curl', 1]],
            legs: [['squat', 4], ['legpress', 3], ['legcurl', 1]],
        },
        dayNotes: { 1: '做臉拉的時候左肩有點緊，活動度不如右邊' },
        expect: {
            status: 'progressing', findings: ['low_volume:side_delts', 'low_volume:rear_delts', 'low_volume:hamstrings', 'low_volume:biceps'],
            options: { 'low_volume:rear_delts': { addTo: 'ex-facepull', addToSets: 2, newExercise: 'Rear Delt Machine' } },
        },
    },
    {
        id: 'knee-note-missed-legs-en',
        why: 'Friday leg day was skipped, and the note says why: a sore knee. The missed-session advice must not just say make up the squats; it has to fit the knee.',
        language: 'en', goal: 'Build muscle', note: 'Skipped Friday legs, my knee was sore after the squats on Wednesday',
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN, routines: PPL, skip: [4],
        expect: { status: 'progressing', findings: ['missed_sessions:-'] },
    },
    {
        id: 'first-report-missed-legs-en',
        why: "A first report (no earlier weeks) with Friday's leg day missed: quads and hamstrings are low only because of it, since the routine's planned sets would have brought both into range. One cause, one finding: they fold into the missed session even with no last week to compare with. Found on the owner's own first week.",
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN, routines: PPL, skip: [4], history: 0,
        expect: { status: 'baseline', findings: ['missed_sessions:-'], records: [] },
    },
    {
        id: 'legs-once-chronic-en',
        why: 'Legs are trained once a week by plan, every week: quads get 7 sets and hamstrings 6, a real volume gap, not a missed session (glutes, at 11, are fine). The squat still counts as a main lift because it leads its routine.',
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: ['push', 'pull', 'legs', 'push', 'pull', null, null], cycle: true, routineNames: NAMES_EN, routines: PPL,
        expect: {
            status: 'progressing', findings: ['low_volume:quads', 'low_volume:hamstrings'],
            // The user already does both hamstring staples, so the only option is more of what they do; 2 sets a week at most
            options: { 'low_volume:quads': { addTo: 'ex-squat', addToSets: 2, newExercise: 'Leg Extension' }, 'low_volume:hamstrings': { addTo: 'ex-rdl', addToSets: 2, newExercise: null } },
        },
    },
    {
        id: 'biceps-from-pulls-zh',
        why: '拉日沒有彎舉，二頭只靠划船和下拉順帶練到（各算半組），每週 7 組，差 3 組；一週最多先加 2 組。建議要給兩種選擇讓使用者挑：在槓鈴划船多做 4 組（順帶練到的算半組，所以要加倍，而且要說明），或加一個新動作啞鈴彎舉 2 組。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: { ...PPL, pull: [['row', 4], ['pulldown', 3], ['facepull', 3]] },
        expect: {
            status: 'progressing', findings: ['low_volume:biceps'],
            options: { 'low_volume:biceps': { addTo: 'ex-row', addToSets: 4, addToHalf: 1, newExercise: 'Dumbbell Curl', newExerciseSets: 2 } },
        },
    },
    {
        id: 'overtime-missed-legs-day-note-zh',
        why: '週五腿日沒練，當天的備註說加班到很晚：漏練規則成立（股四頭和腿後側偏低只因為這次漏練，算在漏練裡）。程式已經把備註對到那一天（腿日，沒練），模型要看懂是加班造成的：不能責怪，建議要實際可行（例如把腿日挪到週末，或下週避開加班的日子）。週日休息日的「睡不好」可以提醒留意，但不能說是它造成什麼。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL, skip: [4],
        dayNotes: { 4: '加班到快十點，沒去健身房', 6: '睡不好' },
        expect: {
            status: 'progressing', findings: ['missed_sessions:-'],
            dayNotes: [{ date: '2026-10-02', routine: '腿日', trained: false }, { date: '2026-10-04', routine: null, trained: false }],
            brief: ['- 2026-10-02 (腿日, not trained): "加班到快十點，沒去健身房"', '- 2026-10-04 (rest day): "睡不好"'],
        },
    },
    {
        id: 'bench-pain-day-note-en',
        why: "The bench press has been stuck at 82.5 kg x 8 for three weeks, which would fire the stall rule. But Thursday's note, on a push day that was trained, says the front of the right shoulder hurt on the bench press, and the period reader reads it as pain. So code holds the bench this week (no more weight, a lighter alternative, getting it checked if it persists) in place of the stall advice, and the model writes no bench action; the headline must not push the bench either.",
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN, routines: PPL,
        progress: { bench: ['77.5x8', '80x8', '82.5x8', '82.5x8', '82.5x8', '82.5x8'] },
        dayNotes: { 3: 'Front of my right shoulder hurt on the bench press today, mostly at the bottom of each rep' },
        // What the period reader (week.ts) reads in that note
        signals: [{ day: 3, source: 'note', kind: 'pain', joint: 'shoulder', exerciseId: 'ex-bench', name: 'Barbell Bench Press', nameZh: '槓鈴臥推', text: 'Front of my right shoulder hurt on the bench press' }],
        expect: {
            status: 'progressing', findings: [],
            planData: { 'pain_hold:ex-bench': { joint: 'shoulder', weightKg: 82.5, low: 8, painSource: 'note' } },
            dayNotes: [{ date: '2026-10-01', routine: 'Push Day', trained: true }],
            brief: ['- 2026-10-01 (Push Day, trained): "Front of my right shoulder hurt on the bench press today, mostly at the bottom of each rep"'],
        },
    },
    {
        id: 'cardio-before-legs-zh',
        why: '兩次腿日都先跑 20 分鐘跑步機才深蹲：先練腿的規則成立，建議把跑步機放到腿部動作後面（或別的時間），5–10 分鐘的暖身可以。理由是下肢肌力，不能說有氧會害肌肉長不大，也不能叫使用者多做或少做有氧。有氧一週 40 分鐘只是事實，不給建議。跑步機不是主要動作，也不算進正式組數。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: { ...PPL, legs: [['treadmill', 2], ...PPL.legs] },
        expect: {
            status: 'progressing', findings: ['cardio_first:-'],
            cardio: { minutes: 40, days: 2, legSessions: 2 },
            brief: ['Cardio this week (the app shows it as a fact; give no advice on how much cardio to do): 40 min on 2 days: 跑步機 40 min, 6.67 km. Last week: 40 min.'],
        },
    },
    {
        id: 'cardio-warmup-and-after-en',
        why: "A lb and miles user. Cardio four days a week, 100 minutes in all, but never 15 minutes before a leg lift: a 10-minute bike warm-up before the squats, the treadmill after the leg work, and the treadmill first only on push days (the order matters for the legs). Nothing fires: the cardio is a fact, and the report must not advise on it.",
        language: 'en', weightUnit: 'lb', distanceUnit: 'mi', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN,
        routines: { ...PPL, push: [['treadmill', 2], ...PPL.push], legs: [['bike', 1], ...PPL.legs, ['treadmill', 2]] },
        expect: {
            status: 'progressing', findings: [],
            cardio: { minutes: 100, days: 4, legSessions: 2 },
            brief: ['Cardio this week (the app shows it as a fact; give no advice on how much cardio to do): 100 min on 4 days: Treadmill 80 min, 8.28 mi; Stationary Bike 20 min. Last week: 100 min.'],
        },
    },
    {
        id: 'cardio-first-partial-zh',
        why: '上週建議腿日先練腿：週三的腿日改成先練腿、跑步機放最後，週五的腿日還是先跑 20 分鐘，所以跟進是部分做到，規則這週也再成立一次（只有週五）。建議要具體說週五那天怎麼排，不能責怪。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: ['push', 'pull', 'legs', 'push', 'legs2', 'pull', null], cycle: true,
        routineNames: { ...NAMES_ZH, legs2: '腿日二' },
        routines: { ...PPL, legs: [...PPL.legs, ['treadmill', 2]], legs2: [['treadmill', 2], ...PPL.legs] },
        previousFindings: [{ id: 'cardio_first:-', rule: 'cardio_first', subject: null, priority: 25, data: { sessions: 2, dates: '2026-09-23, 2026-09-25', date: '2026-09-23', routine: '腿日', minutes: 20, cardio: 'Treadmill', cardioZh: '跑步機', lift: 'Barbell Back Squat', liftZh: '深蹲' } }],
        expect: {
            status: 'progressing', findings: ['cardio_first:-'],
            followUps: { 'cardio_first:-': 'partial' },
            cardio: { minutes: 40, days: 2, legSessions: 2 },
        },
    },
    {
        id: 'assisted-pullup-progress-zh',
        why: '輔助引體向上每週少 2.5 公斤輔助、次數不變：輔助越少越強，所以是進步，而且這週是新紀錄。報告要用輔助公斤數說它，不能當成 0 公斤的自體重量動作。沒有規則成立。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: { ...PPL, pull: [['assisted', 4], ...PPL.pull] },
        expect: {
            status: 'progressing', findings: [], records: ['ex-assisted'],
            lifts: { 'ex-assisted': { trend: 'up', assisted: true } },
        },
    },
    {
        id: 'assisted-stalled-en',
        why: "Assisted pull-ups have been at 30 kg of assist for 8 reps three weeks running: a stall. The advice keeps the assist and adds reps, then lowers the assist one step; it must not talk about adding weight. The goal's \"pull-up\" names it: it is the only pull-up the user trains.",
        language: 'en', goal: 'Get my first pull-up', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN,
        routines: { ...PPL, pull: [['assisted', 4], ...PPL.pull] },
        progress: { assisted: ['a35x6', 'a32.5x6', 'a30x8', 'a30x8', 'a30x8', 'a30x8'] },
        expect: {
            status: 'progressing', findings: ['lift_stalled:ex-assisted'],
            lifts: { 'ex-assisted': { trend: 'flat', assisted: true, goalLift: true } },
            brief: ['- Assisted Pull-up: 8 reps with 30 kg assist (last week 8 reps with 30 kg assist), flat (3 weeks without a new best), 8 sets this week, named in the goal'],
        },
    },
    {
        id: 'heavy-squat-small-steps-en',
        why: 'A 180 kg squat going up 2.5 kg a week is +1.4% a week, inside the flat band, but every week outlifts the one before: the squat is up, not stalled, and nothing needs advice.',
        language: 'en', goal: null, note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        progress: { squat: ['180x5', '182.5x5', '185x5', '187.5x5', '190x5', '192.5x5'] },
        expect: { status: 'progressing', findings: [], lifts: { 'ex-squat': { trend: 'up', flatWindows: 0 } }, records: ['ex-squat'] },
    },
    {
        id: 'weighted-dips-zh',
        why: '雙槓撐體是自體重動作。前三週都是自重 12 下，這週開始加 10 公斤做 8 下：加重就是進步，也是新紀錄。不能算成估計 1RM 從 0 變成「上升 Infinity%」，也不能把它當成退步。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: { ...PPL, push: [['dips', 4], ...PPL.push] },
        progress: { dips: ['0x10', '0x11', '0x12', '0x12', '0x12', '10x8'] },
        expect: {
            status: 'progressing', findings: [], records: ['ex-dips'],
            lifts: { 'ex-dips': { trend: 'up', change: null, added: true } },
            brief: ['- 雙槓撐體: +10 kg x 8 (last week 12 reps (bodyweight)), up (more added weight, or more reps at the same weight, is up), 8 sets this week'],
        },
    },
    {
        id: 'follow-ups-no-data-en',
        why: "Last report flagged weight going up on a cut, and two missed sessions. This week there is no weigh-in and the cycle was removed, so neither can be judged: both stay not done, and the brief says why, instead of calling the weight done or showing \"4 of NaN\".",
        language: 'en', goal: 'Cut to 75 kg', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: false, routines: PPL,
        weights: [80, 80.4, 80.8, 81.2, null],
        previousFindings: [
            { id: 'missed_sessions:-', rule: 'missed_sessions', subject: null, priority: 40, data: { done: 4, planned: 6, missed: 2 } },
            { id: 'weight_trend:-', rule: 'weight_trend', subject: null, priority: 30, data: { direction: 'lose', periods: 4, latestKg: 81.2, changeKg: 0.4 } },
        ],
        expect: {
            status: 'progressing', findings: [],
            followUps: { 'weight_trend:-': 'not_done', 'missed_sessions:-': 'not_done' },
            brief: ['- missed_sessions: not_done, no plan this week to count against', '- weight_trend: not_done, no weigh-in this week to tell'],
        },
    },
    // ---------- A goal's plan (plan.ts) ----------
    {
        id: 'goal-strength-owner-zh',
        why: '擁有者的目標：深蹲 160、臥推 70、自重引體。每個目標一項，第一個選項用他課表裡的動作：臥推照現在的次數加，另外給「先做重的」和「一週多一天」；深蹲一週只練一次，也給多一天；引體還做不到，從滑輪下拉往門檻（體重的 80%）走，能做 55 kg × 6 下時試引體，另外給輔助和離心。力量目標下，側平舉、二頭這些不建議加組；其他主要動作（側平舉、腿彎舉）各一行下次怎麼練；滑輪下拉已經在引體那項，不重複。',
        language: 'zh-TW', goal: '希望可以增加整體力量，深蹲160公斤，臥推70公斤，自重引體', note: null,
        periodStart: '2026-10-12', plan: ['chest', 'back', 'legs', null, null, null, null], cycle: false, history: 1,
        routines: { chest: [['bench', 3], ['lateral', 3]], back: [['pulldown', 4], ['curl', 2]], legs: [['squat', 4], ['legcurl', 2]] },
        progress: { bench: ['40x3', '42.5x8'], lateral: ['7x12', '7x12'], pulldown: ['50x6', '50x6'], curl: ['15x10', '15x10'], squat: ['65x8', '65x8'], legcurl: ['30x12', '30x12'] },
        weights: [81.4, 81.7],
        goalRead: {
            text: '希望可以增加整體力量，深蹲160公斤，臥推70公斤，自重引體', kinds: ['strength'], unread: null, model: 'm',
            targets: [
                { kind: 'lift', text: '深蹲160公斤', exerciseId: 'ex-squat', name: 'Barbell Back Squat', nameZh: '深蹲', loadKg: 160, unit: 'kg' },
                { kind: 'lift', text: '臥推70公斤', exerciseId: 'ex-bench', name: 'Barbell Bench Press', nameZh: '槓鈴臥推', loadKg: 70, unit: 'kg' },
                { kind: 'lift', text: '自重引體', exerciseId: 'ex-pullup', name: 'Pull-up', nameZh: '引體向上', reps: 1 },
            ],
        },
        expect: {
            status: 'progressing', findings: [],
            plan: ['goal_path:ex-squat', 'goal_path:ex-bench', 'goal_path:ex-pullup', 'next_session:ex-lateral', 'next_session:ex-legcurl'],
            planData: {
                'goal_path:ex-bench': { path: 'load', weightKg: 42.5, low: 8, top: 10, nextKg: 45, options: 'heavy,second_day', heavyKg: 45, secondKg: 40 },
                'goal_path:ex-squat': { path: 'load', weightKg: 65, nextKg: 70, options: 'heavy,second_day', secondKg: 60 },
                'goal_path:ex-pullup': { path: 'pulldown', viaId: 'ex-pulldown', weightKg: 50, low: 6, top: 8, nextKg: 52.5, tryAtKg: 55, options: 'assisted,negatives' },
            },
        },
    },
    {
        id: 'goal-pain-and-notes-zh',
        why: '同一個目標，加上他這週跟 Ronnie 說臥推時右手肘痛，和 Ronnie 記得的兩件事：左膝有舊傷、不想做輔助引體。臥推這週先不加重，排第一，給一個對手肘負擔低的胸部動作，和「還痛就給醫師看」；深蹲照常練，但不給更重的和多一天的選項；引體不列輔助引體。',
        language: 'zh-TW', goal: '希望可以增加整體力量，深蹲160公斤，臥推70公斤，自重引體', note: null,
        periodStart: '2026-10-12', plan: ['chest', 'back', 'legs', null, null, null, null], cycle: false, history: 1,
        routines: { chest: [['bench', 3], ['lateral', 3]], back: [['pulldown', 4], ['curl', 2]], legs: [['squat', 4], ['legcurl', 2]] },
        progress: { bench: ['40x3', '42.5x8'], lateral: ['7x12', '7x12'], pulldown: ['50x6', '50x6'], curl: ['15x10', '15x10'], squat: ['65x8', '65x8'], legcurl: ['30x12', '30x12'] },
        weights: [81.4, 81.7],
        goalRead: {
            text: '希望可以增加整體力量，深蹲160公斤，臥推70公斤，自重引體', kinds: ['strength'], unread: null, model: 'm',
            targets: [
                { kind: 'lift', text: '深蹲160公斤', exerciseId: 'ex-squat', name: 'Barbell Back Squat', nameZh: '深蹲', loadKg: 160, unit: 'kg' },
                { kind: 'lift', text: '臥推70公斤', exerciseId: 'ex-bench', name: 'Barbell Bench Press', nameZh: '槓鈴臥推', loadKg: 70, unit: 'kg' },
                { kind: 'lift', text: '自重引體', exerciseId: 'ex-pullup', name: 'Pull-up', nameZh: '引體向上', reps: 1 },
            ],
        },
        memory: [
            { kind: 'injury', subject: 'knee', state: 'active', text: '左膝有舊傷', date: '2026-10-05' },
            { kind: 'exercise', subject: 'ex-assisted', state: 'dislike', text: '不想做輔助引體', date: '2026-10-08' },
        ],
        signals: [{ day: 0, source: 'ronnie', kind: 'pain', joint: 'elbow', exerciseId: 'ex-bench', name: 'Barbell Bench Press', nameZh: '槓鈴臥推', text: '臥推的時候右手肘有點痛' }],
        expect: {
            status: 'progressing', findings: [],
            plan: ['pain_hold:ex-bench', 'goal_path:ex-squat', 'goal_path:ex-pullup', 'next_session:ex-lateral', 'next_session:ex-legcurl'],
            planData: {
                'pain_hold:ex-bench': { joint: 'elbow', weightKg: 42.5, low: 8, painSource: 'ronnie' },
                'goal_path:ex-squat': { options: '', injury: '左膝有舊傷' },
                'goal_path:ex-pullup': { options: 'negatives' },
            },
        },
    },
    {
        id: 'goal-bench-stalled-en',
        why: 'A bench goal, and the bench has been stuck at 90 x 5 for five weeks: the plan takes 10% off and builds back up, in place of the stall rule. For a strength goal only the muscles of the stalled goal lift get more sets: chest, not the side delts, though both are low.',
        language: 'en', goal: 'Bench 100 kg', note: null,
        periodStart: '2026-09-28', plan: ['push', 'pull', 'legs', null, null, null, null], cycle: false,
        routines: { push: [['bench', 3], ['lateral', 2]], pull: PPL.pull, legs: PPL.legs },
        progress: { bench: ['90x5', '90x5', '90x5', '90x5', '90x5', '90x5'] },
        goalRead: { text: 'Bench 100 kg', kinds: ['strength'], unread: null, model: 'm', targets: [{ kind: 'lift', text: 'Bench 100 kg', exerciseId: 'ex-bench', name: 'Barbell Bench Press', nameZh: '槓鈴臥推', loadKg: 100, unit: 'kg' }] },
        expect: {
            status: 'progressing', findings: ['low_volume:chest'],
            planData: { 'goal_path:ex-bench': { path: 'stalled', weightKg: 90, dropKg: 80, flatWindows: 5 } },
        },
    },
    {
        id: 'tired-squat-drop-zh',
        why: '深蹲從 100x6 掉到 92.5x6（約 -7.5%），其他動作都在進步；單看紀錄只是深蹲退步。但這週跟 Ronnie 說「睡不到 5 小時」，週報讀成「很累」：累加上明顯退步，改建議減量一週。程式在減量底下列出每個主要動作輕一點的重量和一半的組數，不再寫「下次加重」；模型的減量建議不列動作和數字，可以提醒照顧睡眠，但不能說睡眠就是原因。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH, routines: PPL,
        progress: { squat: ['90x6', '92.5x6', '95x6', '97.5x6', '100x6', '92.5x6'] },
        signals: [{ day: 2, source: 'ronnie', kind: 'tired', text: '最近工作壓力很大，睡不到 5 小時' }],
        expect: {
            status: 'progressing', findings: ['deload:-'],
            data: { 'deload:-': { lifts: 'Barbell Back Squat', tired: '最近工作壓力很大，睡不到 5 小時', tiredSource: 'ronnie' } },
            planData: { 'next_session:ex-squat': { how: 'deload', weightKg: 85, usualKg: 92.5, sets: 2, usualSets: 4, low: 6 }, 'next_session:ex-bench': { how: 'deload', weightKg: 72.5, usualKg: 80 } },
        },
    },
    {
        id: 'tired-small-dip-en',
        why: 'The user said they slept badly, and the bench slipped from 80x8 to 77.5x8 (about -3%) while the rest went up: tired, but one small dip is not a lighter week, and not a regression either. Nothing fires; code writes the next session for three lifts, and the headline may mention sleep without calling it the cause.',
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN, routines: PPL,
        progress: { bench: ['70x8', '72.5x8', '75x8', '77.5x8', '80x8', '77.5x8'] },
        signals: [{ day: 1, source: 'note', kind: 'tired', text: 'slept badly' }],
        dayNotes: { 1: 'slept badly, felt flat' },
        expect: { status: 'progressing', findings: [] },
    },
    {
        id: 'few-days-no-goal-en',
        why: 'One full-body session a week, every week, no plan and no goal. Health guidelines (WHO 2020) suggest strength training on 2 or more days a week, so code adds a line for 2 days after the next session for the three lifts; nothing else fires, and no sets are added without a goal.',
        language: 'en', goal: null, note: null,
        periodStart: '2026-09-28', plan: ['full', null, null, null, null, null, null], cycle: false,
        routines: { full: [['squat', 4], ['bench', 4], ['row', 4], ['ohp', 3]] },
        expect: {
            status: 'progressing', findings: [],
            plan: ['next_session:ex-squat', 'next_session:ex-bench', 'next_session:ex-row', 'few_days:-'],
            planData: { 'few_days:-': { days: 1, perWeek: 1, target: 2 } },
        },
    },
    {
        id: 'few-days-sick-zh',
        why: '同樣一週只練一天，但這週筆記寫感冒發燒（週報讀成「生病」）：有理由，不提醒每週練 2 天，只有程式寫的下次怎麼練。',
        language: 'zh-TW', goal: null, note: null,
        periodStart: '2026-09-28', plan: ['full', null, null, null, null, null, null], cycle: false,
        routines: { full: [['squat', 4], ['bench', 4], ['row', 4], ['ohp', 3]] },
        dayNotes: { 3: '感冒發燒，這兩天先休息' },
        signals: [{ day: 3, source: 'note', kind: 'sick', text: '感冒發燒' }],
        expect: { status: 'progressing', findings: [], plan: ['next_session:ex-squat', 'next_session:ex-bench', 'next_session:ex-row'] },
    },
    {
        id: 'missed-half-shrink-en',
        why: 'The cycle plans 4 sessions and the user did 2 (Leg Day and the second Push Day skipped), as in the last report, with no reason given. Under 3 in 4 done two weeks running, so the plan shrinks: the advice is a plan of 2 sessions a week they can keep, with each routine\'s first lifts first, not making the missed ones up, and nothing is added: the low muscles get no extra sets.',
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: ['push', 'pull', 'legs', 'push', null, null, null], cycle: true, routineNames: NAMES_EN, routines: PPL, skip: [2, 3], skipEveryPeriod: true,
        previousFindings: [{ id: 'missed_sessions:-', rule: 'missed_sessions', subject: null, priority: 52, data: { done: 2, planned: 4, missed: 2, routines: 'Leg Day, Push Day', dates: '2026-09-23, 2026-09-24', lowGroups: null } }],
        expect: {
            status: 'progressing', findings: ['missed_sessions:-'], followUps: { 'missed_sessions:-': 'not_done' },
            data: { 'missed_sessions:-': { done: 2, planned: 4, shrink: 1, suggest: 2 } },
        },
    },
    {
        id: 'missed-one-of-two-zh',
        why: '循環排 2 次，只練了 1 次（腿日沒練），沒寫目標：完成一半，但縮小到每週 2 次也不比原本少，所以不縮小，照原本建議把腿日找時間補上。',
        language: 'zh-TW', goal: null, note: null,
        periodStart: '2026-09-28', plan: ['push', null, null, 'legs', null, null, null], cycle: true, routineNames: NAMES_ZH,
        routines: { push: [['bench', 4], ['ohp', 4], ['row', 4], ['pulldown', 3]], legs: PPL.legs }, skip: [3],
        expect: { status: 'progressing', findings: ['missed_sessions:-'], data: { 'missed_sessions:-': { done: 1, planned: 2, shrink: undefined } } },
    },
]
