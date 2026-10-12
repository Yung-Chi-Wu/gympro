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
    ['legcurl', 'Leg Curl', '腿彎舉', 'legs'],
    ['hipthrust', 'Hip Thrust', '臀推', 'glutes'],
    ['plank', 'Plank', '棒式', 'core'],
    ['assisted', 'Assisted Pull-up', '輔助引體向上', 'back'],
    ['treadmill', 'Treadmill', '跑步機', 'cardio'],
    ['bike', 'Stationary Bike', '健身車', 'cardio'],
]
// Each takes the reviewed muscles of its counterpart in the real library
const ATTRIBUTES = createRequire(import.meta.url)('../../../../supabase/data/exercise-attributes.json')
const LIBRARY_NAME = { 'Incline Dumbbell Press': 'Incline Dumbbell Bench Press', Dips: 'Triceps Dip' }
function musclesOf(name) {
    const a = ATTRIBUTES.find((x) => x.name === (LIBRARY_NAME[name] ?? name))
    if (!a) throw new Error(`scenario exercise ${name} has no counterpart in exercise-attributes.json`)
    return { primaryMuscles: a.primary, secondaryMuscles: a.secondary, logType: a.logType }
}
// The rest of the library, untrained, as the report sees it: a low muscle's advice may suggest one of its staples
const IN_SCENARIOS = new Set(LIBRARY.map(([, name]) => LIBRARY_NAME[name] ?? name))
export const EXERCISES = [
    ...LIBRARY.map(([key, name, nameZh, muscleGroup]) => ({ id: `ex-${key}`, name, nameZh, muscleGroup, ...musclesOf(name) })),
    ...ATTRIBUTES.filter((a) => !IN_SCENARIOS.has(a.name))
        .map((a) => ({ id: a.id, name: a.name, nameZh: a.nameZh, muscleGroup: a.muscleGroup, primaryMuscles: a.primary, secondaryMuscles: a.secondary, logType: a.logType })),
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
        why: '第一份報告：沒有之前的資料，狀態是「基準」，不能說停滯或退步。拉日一週只排一次：背 9 組（划船、下拉 6 組，加上側平舉順帶練到上斜方的半組）、肩後束 1.5 組（划船算半組）、二頭 6 組都偏低，訓練量規則照樣成立，而且三個肌群合成一條建議。',
        language: 'zh-TW', goal: null, note: null,
        periodStart: '2026-09-28', plan: ['push', 'pull', 'legs', null, 'push', null, 'legs'], cycle: false, routines: { ...PPL, pull: [['row', 3], ['pulldown', 3], ['curl', 3]] }, history: 0,
        expect: {
            status: 'baseline', findings: ['low_volume:back', 'low_volume:rear_delts', 'low_volume:biceps'], records: [],
            // Rear delts need 9 more: 18 sets of rows (half each) is no real option, so only the new exercise
            options: { 'low_volume:rear_delts': { addTo: null, newExercise: 'Rear Delt Machine' }, 'low_volume:biceps': { addTo: 'ex-curl', addToSets: 4, newExercise: 'Dumbbell Curl' } },
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
            // 10 more overhead-press sets (half each) is no real option, so only the new exercise
            options: { 'low_volume:side_delts': { addTo: null, newExercise: 'Lateral Raise' } },
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
        expect: { status: 'progressing', findings: ['lift_stalled:ex-squat'], records: ['ex-bench'] },
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
            // The user already does both hamstring staples, so the only option is more of what they do
            options: { 'low_volume:quads': { addTo: 'ex-squat', addToSets: 3, newExercise: 'Leg Extension' }, 'low_volume:hamstrings': { addTo: 'ex-rdl', addToSets: 4, newExercise: null } },
        },
    },
    {
        id: 'biceps-from-pulls-zh',
        why: '拉日沒有彎舉，二頭只靠划船和下拉順帶練到（各算半組），每週 7 組，差 3 組。建議要給兩種選擇讓使用者挑：在槓鈴划船多做 6 組（順帶練到的算半組，所以要加倍，而且要說明），或加一個新動作啞鈴彎舉 3 組。',
        language: 'zh-TW', goal: '增肌', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_ZH,
        routines: { ...PPL, pull: [['row', 4], ['pulldown', 3], ['facepull', 3]] },
        expect: {
            status: 'progressing', findings: ['low_volume:biceps'],
            options: { 'low_volume:biceps': { addTo: 'ex-row', addToSets: 6, addToHalf: 1, newExercise: 'Dumbbell Curl', newExerciseSets: 3 } },
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
        why: "The bench press has been stuck at 82.5 kg x 8 for three weeks, so the stall rule fires and its advice is double progression (more reps, then more weight). But Thursday's note, on a push day that was trained, says the front of the right shoulder hurt on the bench press. The advice can't simply push reps and load on the bench: it has to fit the shoulder (a pain-free range or variation, a lighter load, getting it checked if it persists).",
        language: 'en', goal: 'Build muscle', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN, routines: PPL,
        progress: { bench: ['77.5x8', '80x8', '82.5x8', '82.5x8', '82.5x8', '82.5x8'] },
        dayNotes: { 3: 'Front of my right shoulder hurt on the bench press today, mostly at the bottom of each rep' },
        expect: {
            status: 'progressing', findings: ['lift_stalled:ex-bench'],
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
        why: "Assisted pull-ups have been at 30 kg of assist for 8 reps three weeks running: a stall. The advice keeps the assist and adds reps, then lowers the assist one step; it must not talk about adding weight.",
        language: 'en', goal: 'Get my first pull-up', note: null,
        periodStart: '2026-09-28', plan: WEEK, cycle: true, routineNames: NAMES_EN,
        routines: { ...PPL, pull: [['assisted', 4], ...PPL.pull] },
        progress: { assisted: ['a35x6', 'a32.5x6', 'a30x8', 'a30x8', 'a30x8', 'a30x8'] },
        expect: {
            status: 'progressing', findings: ['lift_stalled:ex-assisted'],
            lifts: { 'ex-assisted': { trend: 'flat', assisted: true } },
            brief: ['- Assisted Pull-up: 8 reps with 30 kg assist (last week 8 reps with 30 kg assist), flat (3 weeks without a new best), 8 sets this week'],
        },
    },
]
