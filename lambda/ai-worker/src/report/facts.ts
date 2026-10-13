import { addDays, daysBetween } from '../../../../lib/periods'
import { hasTarget, setWeights, VOLUME_UNIT_IDS } from '../../../../lib/report/volume'
import { isCardio } from '../../../../lib/set-log'
import type { LogType } from '../../../../lib/exercise-attributes'
import type { BestSet, CardioFacts, ExerciseInfo, LiftFacts, LoggedSet, MuscleFacts, RecordFacts, ReportFacts, ReportInputs, ReportStatus } from './types'

// Every number in the report, computed from the logged sets. Pure: the same inputs
// give the same facts, so the rules and the eval can rely on them.
//
// The period is compared with the windows before it, each as long as the period
// (a week, or one custom cycle): window 0 is this period, window 1 the one before.

export const WINDOWS = 6
/** Estimated-1RM changes within ±1.5% count as flat: rounding, or one rep at a light weight */
export const FLAT_BAND = 0.015
/** Hard sets per muscle per week where growth is well supported. Which muscles it applies to,
 *  and how a set counts toward them, is in lib/report/volume.ts. */
export const VOLUME_RANGE = { low: 10, high: 20 } as const
const NOT_LIFTS = new Set(['cardio', 'core'])
/** Log types a main lift can have: a timed hold or a cardio machine has no best set to compare */
const STRENGTH_LOG_TYPES = new Set<LogType>(['weight_reps', 'bodyweight', 'assisted'])
const MAIN_LIFTS = 5

/** Estimated one-rep max (Epley). */
export const e1rm = (s: { weightKg: number; reps: number }) => s.weightKg * (1 + s.reps / 30)
const round1 = (n: number) => Math.round(n * 10) / 10

/** Cardio: a cardio log type, or a custom exercise in the cardio category. Its sets aren't working sets. */
export const isCardioExercise = (e: ExerciseInfo | undefined) => !!e && (isCardio(e.logType) || e.muscleGroup === 'cardio')

/** The units a lower-body lift mainly trains: the ones cardio before it interferes with */
const LOWER_BODY_UNITS = new Set(['quads', 'hamstrings', 'glutes'])
/** A strength lift that mainly trains the legs; a custom exercise, by its legs or glutes category. */
export function isLowerBodyLift(e: ExerciseInfo): boolean {
    if (!STRENGTH_LOG_TYPES.has(e.logType) || NOT_LIFTS.has(e.muscleGroup)) return false
    if (!e.primaryMuscles.length) return e.muscleGroup === 'legs' || e.muscleGroup === 'glutes'
    return setWeights(e.primaryMuscles, [], e.muscleGroup).some(([unit]) => LOWER_BODY_UNITS.has(unit))
}

/**
 * The sets that count for a lift, and how they compare. An assisted lift counts only sets that
 * have their assist (one logged before the exercise had a log type has none) and is ordered by
 * less assist, then more reps at the same assist, as the app and Ronnie read it: reps/1000 can't
 * outweigh an assist step (at least 1 lb), so one number keeps that order. A bodyweight exercise
 * with added weight on some sets is ordered the same way by the added weight: its bodyweight sets
 * have no estimated 1RM, which read as 0 and made "up Infinity%". Only bodyweight sets: by reps.
 * A weighted lift by estimated 1RM, without its 0 kg sets, which have none either.
 */
function liftMeasure(e: ExerciseInfo, allSets: LoggedSet[]) {
    const assisted = e.logType === 'assisted'
    const own = allSets.filter((s) => s.exerciseId === e.id && (!assisted || s.assistKg != null))
    const bodyweight = !assisted && own.every((s) => s.weightKg === 0)
    const added = !assisted && !bodyweight && e.logType === 'bodyweight'
    const sets = assisted || bodyweight || added ? own : own.filter((s) => s.weightKg > 0)
    const value = (s: BestSet | LoggedSet) =>
        assisted ? s.reps / 1000 - (s.assistKg ?? 0) : added ? s.weightKg + s.reps / 1000 : bodyweight ? s.reps : e1rm(s)
    return { sets, assisted, bodyweight, added, value }
}

/**
 * Progress that can't be rounding counts however small: more weight for at least as many reps,
 * or more reps at the same weight. 180 to 182.5 kg x5 is +1.4% of a heavy squat, inside the band.
 */
const outlifts = (a: BestSet | LoggedSet, b: BestSet | LoggedSet) =>
    (a.weightKg > b.weightKg && a.reps >= b.reps) || (a.weightKg === b.weightKg && a.reps > b.reps)
const bestOf = (s: LoggedSet, assisted: boolean): BestSet =>
    assisted ? { weightKg: s.weightKg, reps: s.reps, assistKg: s.assistKg ?? 0 } : { weightKg: s.weightKg, reps: s.reps }

/** Which window a date falls in: 0 for this period, 1 for the one before, -1 after it. */
export function windowOfFor(periodStart: string, periodEnd: string) {
    const days = daysBetween(periodStart, periodEnd) + 1
    return (date: string) => {
        const back = daysBetween(date, periodEnd)
        return back < 0 ? -1 : Math.floor(back / days)
    }
}

/** Every exercise the user has logged, which tells whether a goal's "squat" can only mean one of them */
const trainedExercises = (inputs: ReportInputs) => {
    const logged = new Set(inputs.sets.map((s) => s.exerciseId))
    return inputs.exercises.filter((e) => logged.has(e.id))
}

/** One exercise's facts, for following up a lift that may no longer be a main lift. */
export function liftFor(inputs: ReportInputs, exerciseId: string): LiftFacts | null {
    const e = inputs.exercises.find((x) => x.id === exerciseId)
    if (!e) return null
    const windowOf = windowOfFor(inputs.periodStart, inputs.periodEnd)
    return liftMeasure(e, inputs.sets).sets.some((s) => windowOf(s.date) === 0) ? liftFacts(e, inputs.sets, windowOf, inputs.goal, trainedExercises(inputs)) : null
}

export function computeFacts(inputs: ReportInputs): ReportFacts {
    const { periodStart, periodEnd } = inputs
    const days = daysBetween(periodStart, periodEnd) + 1
    const windowOf = windowOfFor(periodStart, periodEnd)
    const inWindow = (k: number) => inputs.sets.filter((s) => windowOf(s.date) === k)
    const current = inWindow(0)
    const byId = new Map(inputs.exercises.map((e) => [e.id, e]))
    const hasHistory = inputs.sets.some((s) => s.date < periodStart)
    // Working sets: a treadmill split logged as two sets isn't two sets of training
    const working = (sets: LoggedSet[]) => sets.filter((s) => !isCardioExercise(byId.get(s.exerciseId)))

    // Sessions: a day with at least one set
    const trainedDates = new Set(current.map((s) => s.date))
    const dayList = Array.from({ length: days }, (_, i) => addDays(periodStart, i))
    const planFor = new Map((inputs.schedule ?? []).map((d) => [d.date, d.routine]))
    const sessions = {
        done: trainedDates.size,
        planned: inputs.schedule ? inputs.schedule.filter((d) => d.routine).length : null,
        days: dayList.map((date) => ({ date, routine: planFor.get(date) ?? null, trained: trainedDates.has(date) })),
    }

    // Sets per volume unit, scaled to a week: 1 for a primary muscle, 0.5 for a secondary one
    const setsByUnit = (sets: LoggedSet[]) => {
        const out = new Map<string, number>()
        for (const s of sets) {
            const e = byId.get(s.exerciseId)
            if (!e) continue
            for (const [unit, w] of setWeights(e.primaryMuscles, e.secondaryMuscles, e.muscleGroup)) out.set(unit, (out.get(unit) ?? 0) + w)
        }
        return out
    }
    const perWeek = (n: number) => round1((n * 7) / days)
    // What the planned sessions that weren't trained would have added, from their routines' target sets
    const missedUnits = new Map<string, number>()
    for (const d of inputs.schedule ?? []) {
        if (!d.routine || trainedDates.has(d.date)) continue
        for (const p of d.plan) {
            const e = byId.get(p.exerciseId)
            if (!e) continue
            for (const [unit, w] of setWeights(e.primaryMuscles, e.secondaryMuscles, e.muscleGroup)) missedUnits.set(unit, (missedUnits.get(unit) ?? 0) + w * p.sets)
        }
    }
    const nowUnits = setsByUnit(current)
    const prevUnits = setsByUnit(inWindow(1))
    const recentUnits = new Set([1, 2, 3].flatMap((k) => [...setsByUnit(inWindow(k)).keys()]))
    // In the units' own order; a unit with a range stays listed while it was trained recently
    const units = VOLUME_UNIT_IDS.filter((u) => nowUnits.has(u) || (hasTarget(u) && recentUnits.has(u)))
    const muscles: MuscleFacts[] = units.map((group) => {
        const sets = nowUnits.get(group) ?? 0
        const week = perWeek(sets)
        const status = !hasTarget(group) ? 'no_target' : week < VOLUME_RANGE.low ? 'low' : week > VOLUME_RANGE.high ? 'high' : 'ok'
        return {
            group, sets, perWeek: week, status,
            previousPerWeek: hasHistory ? perWeek(prevUnits.get(group) ?? 0) : null,
            missedPerWeek: inputs.schedule ? perWeek(missedUnits.get(group) ?? 0) : null,
        }
    })

    // Lifts
    const goalDirection = goalDirectionOf(inputs.goal)
    const trainedNow = [...new Set(current.map((s) => s.exerciseId))].map((id) => byId.get(id))
        .filter((e): e is ExerciseInfo => !!e && !NOT_LIFTS.has(e.muscleGroup) && STRENGTH_LOG_TYPES.has(e.logType))
        .filter((e) => liftMeasure(e, current).sets.length > 0)
    const userExercises = trainedExercises(inputs)
    const allLifts = trainedNow.map((e) => liftFacts(e, inputs.sets, windowOf, inputs.goal, userExercises))
    // Main lifts: the goal's lifts and each routine's first exercise, then the most sets over the
    // last 4 periods (so one missed session doesn't drop a lift), then the most weight moved
    const leads = new Set(inputs.routineLeads)
    const recentSets = (id: string) => inputs.sets.filter((s) => s.exerciseId === id && windowOf(s.date) >= 0 && windowOf(s.date) < 4).length
    const tonnage = (id: string) => current.filter((s) => s.exerciseId === id).reduce((a, s) => a + s.weightKg * s.reps, 0)
    const ranked = [...allLifts].sort((a, b) =>
        Number(b.goalLift) - Number(a.goalLift) || Number(leads.has(b.exerciseId)) - Number(leads.has(a.exerciseId))
        || recentSets(b.exerciseId) - recentSets(a.exerciseId) || tonnage(b.exerciseId) - tonnage(a.exerciseId) || a.name.localeCompare(b.name))
    const lifts = ranked.filter((l, i) => l.goalLift || i < MAIN_LIFTS).slice(0, MAIN_LIFTS + 1)

    // Records on the main lifts: this period's best beats every earlier set of the exercise
    const records: RecordFacts[] = []
    for (const lift of lifts) {
        const { sets, value } = liftMeasure(byId.get(lift.exerciseId)!, inputs.sets)
        const earlier = sets.filter((s) => s.date < periodStart)
        if (!earlier.length || !lift.best) continue
        const before = Math.max(...earlier.map((s) => value(s)))
        if (value(lift.best) > before) {
            const best = lift.best
            const set = sets.find((s) => s.date >= periodStart && s.reps === best.reps && s.weightKg === best.weightKg && (best.assistKg == null || s.assistKg === best.assistKg))!
            records.push({
                exerciseId: lift.exerciseId, name: lift.name, nameZh: lift.nameZh, best, bodyweight: lift.bodyweight, assisted: !!lift.assisted,
                ...(lift.added ? { added: true } : {}), date: set.date,
            })
        }
    }

    const comparable = lifts.filter((l) => l.trend !== 'new')
    const liftsSummary = {
        up: comparable.filter((l) => l.trend === 'up').length,
        flat: comparable.filter((l) => l.trend === 'flat').length,
        down: comparable.filter((l) => l.trend === 'down').length,
    }
    const status: ReportStatus = !comparable.length ? 'baseline'
        : liftsSummary.down > liftsSummary.up ? 'regressing'
        : liftsSummary.up > liftsSummary.down ? 'progressing'
        : 'stalling'

    return {
        period: { start: periodStart, end: periodEnd, days },
        sessions,
        totalSets: { now: working(current).length, previous: hasHistory ? working(inWindow(1)).length : null },
        muscles,
        lifts,
        records,
        bodyWeight: bodyWeightFacts(inputs.weighIns, windowOf),
        status,
        liftsSummary,
        goal: { text: inputs.goal, direction: goalDirection },
        cardio: cardioFacts(inputs, windowOf, hasHistory),
    }
}

/**
 * How much cardio, and what: minutes, and distance where the machine gives one. A cardio set
 * logged before its exercise had a log type has no time, and isn't counted. On each lower-body
 * day, the cardio minutes logged before the first leg set, in the order the sets were logged.
 */
function cardioFacts(inputs: ReportInputs, windowOf: (date: string) => number, hasHistory: boolean): CardioFacts {
    const byId = new Map(inputs.exercises.map((e) => [e.id, e]))
    const timed = (s: LoggedSet) => isCardioExercise(byId.get(s.exerciseId)) && s.durationS != null
    const minutesOf = (sets: LoggedSet[]) => Math.round(sets.reduce((a, s) => a + (s.durationS ?? 0), 0) / 60)
    const days = daysBetween(inputs.periodStart, inputs.periodEnd) + 1
    const perWeek = (minutes: number) => Math.round((minutes * 7) / days)
    const current = inputs.sets.filter((s) => windowOf(s.date) === 0)
    const cardio = current.filter(timed)

    const exercises = [...new Set(cardio.map((s) => s.exerciseId))].map((id) => {
        const e = byId.get(id)!
        const own = cardio.filter((s) => s.exerciseId === id)
        const km = own.reduce((a, s) => a + ((s.speedKmh ?? 0) * (s.durationS ?? 0)) / 3600, 0)
        return {
            exerciseId: id, name: e.name, nameZh: e.nameZh, logType: e.logType,
            minutes: minutesOf(own),
            km: e.logType === 'treadmill' ? Math.round(km * 100) / 100 : null,
            metres: e.logType === 'rower' ? own.reduce((a, s) => a + (s.distanceM ?? 0), 0) : null,
            days: new Set(own.map((s) => s.date)).size,
        }
    }).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))

    const routineOn = new Map((inputs.schedule ?? []).map((d) => [d.date, d.routine]))
    const at = (s: LoggedSet) => Date.parse(s.loggedAt)
    const legSessions = [...new Set(current.map((s) => s.workoutId))].flatMap((workoutId) => {
        const sets = current.filter((s) => s.workoutId === workoutId).sort((a, b) => at(a) - at(b))
        const firstLeg = sets.find((s) => byId.has(s.exerciseId) && isLowerBodyLift(byId.get(s.exerciseId)!))
        if (!firstLeg) return []
        const before = sets.filter((s) => timed(s) && at(s) < at(firstLeg))
        const most = [...new Set(before.map((s) => s.exerciseId))]
            .map((id) => ({ id, minutes: minutesOf(before.filter((s) => s.exerciseId === id)) }))
            .sort((a, b) => b.minutes - a.minutes)[0]
        const nameOf = (id: string) => ({ name: byId.get(id)!.name, nameZh: byId.get(id)!.nameZh })
        return [{
            date: firstLeg.date,
            routine: routineOn.get(firstLeg.date) ?? null,
            minutesBefore: minutesOf(before),
            cardio: most ? nameOf(most.id) : null,
            lift: nameOf(firstLeg.exerciseId),
        }]
    }).sort((a, b) => a.date.localeCompare(b.date))

    return {
        minutes: minutesOf(cardio),
        perWeek: perWeek(minutesOf(cardio)),
        previousPerWeek: hasHistory ? perWeek(minutesOf(inputs.sets.filter((s) => windowOf(s.date) === 1 && timed(s)))) : null,
        days: new Set(cardio.map((s) => s.date)).size,
        exercises,
        legSessions,
    }
}

function liftFacts(e: ExerciseInfo, allSets: LoggedSet[], windowOf: (date: string) => number, goal: string | null, userExercises: ExerciseInfo[]): LiftFacts {
    const { sets, assisted, bodyweight, added, value } = liftMeasure(e, allSets)
    const bestIn = (k: number) => {
        const inK = sets.filter((s) => windowOf(s.date) === k)
        return inK.length ? inK.reduce((a, b) => (value(b) > value(a) ? b : a)) : null
    }
    const bests = Array.from({ length: WINDOWS }, (_, k) => bestIn(k))
    // An assisted or added-weight lift's number is an order, not an amount: kept exact, never rounded
    const series = bests.map((b) => (b ? (assisted || added ? value(b) : round1(value(b))) : null)).reverse()
    const best = bests[0] ? bestOf(bests[0], assisted) : null
    const prevIndex = bests.findIndex((b, k) => k > 0 && b)
    const prev = prevIndex > 0 ? bests[prevIndex]! : null

    // Reps, assist and added weight move in whole steps: any change counts. An estimated 1RM has to
    // clear the band, unless the set outlifts the other one; a drop always has to clear it, since one
    // heavy day isn't a regression.
    const exact = bodyweight || assisted || added
    const beats = (a: LoggedSet, b: LoggedSet) => (exact ? value(a) > value(b) : outlifts(a, b) || value(a) > value(b) * (1 + FLAT_BAND))
    let trend: LiftFacts['trend'] = 'new'
    let change: number | null = null
    if (bests[0] && prev) {
        const now = value(bests[0])
        const before = value(prev)
        change = assisted || added ? null : bodyweight ? now - before : round1(((now - before) / before) * 100)
        const down = exact ? now < before : now < before * (1 - FLAT_BAND)
        trend = beats(bests[0], prev) ? 'up' : down ? 'down' : 'flat'
    }

    // Walk the trained windows oldest first. A run is measured from the best it started at, not the
    // best so far: small steady gains each stay inside the band, but they add up past it.
    const trainedSets = bests.filter((b): b is LoggedSet => b != null).reverse()
    let flatWindows = 0
    let from = trainedSets[0]
    for (const b of trainedSets.slice(1)) {
        if (beats(b, from)) {
            flatWindows = 0
            from = b
        } else flatWindows++
    }
    const trained = series.filter((v): v is number => v != null)
    let downWindows = 0
    for (let i = trained.length - 1; i > 0; i--) {
        const lower = exact ? trained[i] < trained[i - 1] : trained[i] < trained[i - 1] * (1 - FLAT_BAND)
        if (!lower) break
        downWindows++
    }

    return {
        exerciseId: e.id,
        name: e.name,
        nameZh: e.nameZh,
        muscleGroup: e.muscleGroup,
        sets: sets.filter((s) => windowOf(s.date) === 0).length,
        best,
        previousBest: prev ? bestOf(prev, assisted) : null,
        bodyweight,
        assisted,
        ...(added ? { added: true } : {}),
        series,
        trend,
        change,
        flatWindows: best ? flatWindows : 0,
        downWindows,
        goalLift: goalMentions(goal, e, userExercises),
    }
}

function bodyWeightFacts(weighIns: ReportInputs['weighIns'], windowOf: (date: string) => number): ReportFacts['bodyWeight'] {
    const avg = (k: number) => {
        const w = weighIns.filter((x) => windowOf(x.date) === k).map((x) => x.weightKg)
        return w.length ? round1(w.reduce((a, b) => a + b, 0) / w.length) : null
    }
    const byWindow = Array.from({ length: WINDOWS }, (_, k) => avg(k))
    const latest = [...weighIns].filter((x) => windowOf(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
    // The last earlier window with weigh-ins, which may be more than one back: the app says how far
    const back = byWindow.findIndex((v, k) => k > 0 && v != null)
    const lastBefore = back > 0 ? byWindow[back] : null

    // Consecutive moves the same way between trained windows, ending with this one
    const known = byWindow.slice().reverse().filter((v): v is number => v != null)
    let trendWindows = 0
    for (let i = known.length - 1; i > 0; i--) {
        // Rounded first: 72.7 - 72.8 is -0.0999... in floating point
        const diff = round1(known[i] - known[i - 1])
        const dir = diff >= 0.1 ? 1 : diff <= -0.1 ? -1 : 0
        if (dir === 0 || (trendWindows !== 0 && Math.sign(trendWindows) !== dir)) break
        trendWindows += dir
    }
    return {
        latestKg: latest?.weightKg ?? null,
        changeKg: byWindow[0] != null && lastBefore != null ? round1(byWindow[0] - lastBefore) : null,
        changeWindows: byWindow[0] != null && lastBefore != null ? back : null,
        weighIns: weighIns.filter((x) => windowOf(x.date) === 0).length,
        series: byWindow.slice().reverse(),
        trendWindows: byWindow[0] == null ? 0 : trendWindows,
    }
}

// ---------- The goal, read from free text ----------

// English as whole words: "again" isn't gain, "clean" isn't lean, "closer" isn't lose
const GAIN = /增肌|增重|長肌肉|練大|\b(bulk(ing)?|gain(ing)?|build(ing)? muscle|put(ting)? on)\b/i
const LOSE = /減脂|減重|減肥|瘦|\b(fat loss|lose|losing|cut(ting)?|lean(er)?)\b/i

export function goalDirectionOf(goal: string | null): 'gain' | 'lose' | null {
    if (!goal) return null
    const gain = GAIN.test(goal)
    const lose = LOSE.test(goal)
    return gain && !lose ? 'gain' : lose && !gain ? 'lose' : null
}

const EQUIPMENT_ZH = /^(槓鈴|啞鈴|繩索|器械|史密斯|壺鈴)/
const EQUIPMENT_EN = /^(barbell|dumbbell|cable|machine|smith machine|kettlebell)\s+/i

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const lastWord = (name: string) => name.toLowerCase().split(' ').at(-1) ?? ''

/**
 * Whether the goal names this exercise, with or without its equipment ("臥推" names 槓鈴臥推). An
 * English name as whole words, plural or not, so Machine Row's "row" isn't in "grow". A goal
 * usually says just "squat" or "bench": the last word names the exercise when no other one the
 * user trains (`trained`) ends in it, so "squat 140" is Barbell Back Squat, unless there's a
 * Front Squat too.
 */
export function goalMentions(goal: string | null, e: ExerciseInfo, trained: ExerciseInfo[] = []): boolean {
    if (!goal) return false
    const text = goal.toLowerCase()
    const en = e.name.toLowerCase()
    const stripped = en.replace(EQUIPMENT_EN, '')
    // Not \b, which fails next to a name's own brackets and splits "pull-ups" into a "pull" (Face
    // Pull's last word); Chinese around an English name is fine
    const inText = (n: string) => new RegExp(`(?<![a-z0-9-])${escapeRegExp(n)}s?(?![a-z0-9-])`).test(text)
    if ([en, stripped].some((n) => n.length >= 2 && inText(n))) return true
    if (e.nameZh && [e.nameZh, e.nameZh.replace(EQUIPMENT_ZH, '')].some((n) => n.length >= 2 && text.includes(n))) return true
    const last = lastWord(stripped)
    return last !== stripped && last.length >= 4 && inText(last) && !trained.some((x) => x.id !== e.id && lastWord(x.name) === last)
}
