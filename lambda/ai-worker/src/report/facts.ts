import { addDays, daysBetween } from '../../../../lib/periods'
import { hasTarget, setWeights, VOLUME_UNIT_IDS } from '../../../../lib/report/volume'
import { isLowerBodyLift, NOT_LIFTS, plansThrough, REPORT_WINDOWS, STRENGTH_LOG_TYPES, topSession, windowOfFor } from '../../../../lib/report/progression'
import { isCardio } from '../../../../lib/set-log'
import type { LogType } from '../../../../lib/exercise-attributes'
import { intensityOf, maxHeartRate, moderateEquivalent } from '../../../../lib/report/cardio-intensity'
import type { BestSet, CardioFacts, CardioIntensityFacts, CardioTrendFacts, ExerciseInfo, GoalProgress, GoalTarget, LiftFacts, LoggedSet, MuscleFacts, RecordFacts, ReportFacts, ReportInputs, ReportStatus } from './types'

// Every number in the report, computed from the logged sets. Pure: the same inputs
// give the same facts, so the rules and the eval can rely on them.
//
// The period is compared with the windows before it, each as long as the period
// (a week, or one custom cycle): window 0 is this period, window 1 the one before.

export const WINDOWS = REPORT_WINDOWS
/** Estimated-1RM changes within ±1.5% count as flat: rounding, or one rep at a light weight */
export const FLAT_BAND = 0.015
/** Hard sets per muscle per week where growth is well supported. Which muscles it applies to,
 *  and how a set counts toward them, is in lib/report/volume.ts. */
export const VOLUME_RANGE = { low: 10, high: 20 } as const
const MAIN_LIFTS = 5

/** Estimated one-rep max (Epley). */
export const e1rm = (s: { weightKg: number; reps: number }) => s.weightKg * (1 + s.reps / 30)
const round1 = (n: number) => Math.round(n * 10) / 10

/** Cardio: a cardio log type, or a custom exercise in the cardio category. Its sets aren't working sets. */
export const isCardioExercise = (e: ExerciseInfo | undefined) => !!e && (isCardio(e.logType) || e.muscleGroup === 'cardio')

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

// Which window a date falls in, as the plan counts them (lib/report/progression.ts)
export { windowOfFor }

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
    return liftMeasure(e, inputs.sets).sets.some((s) => windowOf(s.date) === 0) ? liftFacts(e, inputs.sets, windowOf, inputs.goal, trainedExercises(inputs), inputs.weightUnit ?? 'kg') : null
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
    const targeted = new Set((inputs.goalRead?.targets ?? []).flatMap((t) => (t.exerciseId ? [t.exerciseId] : [])))
    const allLifts = trainedNow.map((e) => liftFacts(e, inputs.sets, windowOf, inputs.goal, userExercises, inputs.weightUnit ?? 'kg'))
        .map((l) => (targeted.has(l.exerciseId) ? { ...l, goalLift: true } : l))
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

    const bodyWeight = bodyWeightFacts(inputs.weighIns, windowOf)
    return {
        period: { start: periodStart, end: periodEnd, days },
        sessions,
        totalSets: { now: working(current).length, previous: hasHistory ? working(inWindow(1)).length : null },
        muscles,
        lifts,
        records,
        bodyWeight,
        status,
        liftsSummary,
        goal: {
            text: inputs.goal,
            direction: goalDirection,
            // Only where the goal was read: an eval or a report saved before has neither
            ...(inputs.goalRead !== undefined ? {
                read: inputs.goalRead,
                progress: (inputs.goalRead?.targets ?? []).map((t) => goalProgressOf(t, inputs, windowOf, muscles, bodyWeight)),
            } : {}),
        },
        cardio: cardioFacts(inputs, windowOf, hasHistory),
        // Only where the period was read: an eval or a report saved before has neither
        ...(inputs.weekRead !== undefined ? { context: { memory: (inputs.memory ?? []).slice(-MAX_CONTEXT_NOTES), week: inputs.weekRead } } : {}),
    }
}

/** Ronnie's notes kept with a report, the latest: a user has a few, and only abuse reaches Ronnie's cap of 200 */
const MAX_CONTEXT_NOTES = 100

// ---------- How far the goal is ----------

/** A goal lift's estimated one-rep max comes from sets of this many reps or fewer: past 10 the estimates drift apart (Reynolds 2006) */
export const GOAL_MAX_REPS = 10
/** A goal's change is shown once this many windows have a value: one or two sessions are noise */
export const GOAL_TREND_POINTS = 3
/**
 * A pulldown 1RM this share of body weight likely comes with a first pull-up: in Johnson 2009 the
 * lat pull's 1RM was about 75-80% of the pull-up's, and a first pull-up is a pull-up 1RM of about
 * body weight. The top of that range, so the report doesn't call it close too early. GymPro's
 * reading of the study, which the report calls an estimate.
 */
export const PULL_UP_PULLDOWN_SHARE = 0.8
const PULL_UP = /pull-?up|chin-?up/i
const PULLDOWN = /pulldown|pull-down/i
const round2 = (n: number) => Math.round(n * 100) / 100

/** A series' change from its first value to its last, once enough windows have one */
function seriesChange(series: (number | null)[]): { change: number | null; changeWindows: number | null } {
    const at = series.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0)
    if (at.length < GOAL_TREND_POINTS) return { change: null, changeWindows: null }
    return { change: round1(series[at.at(-1)!]! - series[at[0]]!), changeWindows: at.at(-1)! - at[0] }
}

/** The best estimated 1RM in each window, oldest first, from the lift's sets of GOAL_MAX_REPS or fewer */
function e1rmSeries(sets: LoggedSet[], exerciseId: string, windowOf: (date: string) => number): (number | null)[] {
    const own = sets.filter((s) => s.exerciseId === exerciseId && s.weightKg > 0 && s.reps >= 1 && s.reps <= GOAL_MAX_REPS)
    return Array.from({ length: WINDOWS }, (_, k) => {
        const inK = own.filter((s) => windowOf(s.date) === k)
        return inK.length ? round1(Math.max(...inK.map(e1rm))) : null
    }).reverse()
}
const latestOf = (series: (number | null)[]) => [...series].reverse().find((v) => v != null) ?? null

export function goalProgressOf(target: GoalTarget, inputs: ReportInputs, windowOf: (date: string) => number, muscles: MuscleFacts[], bodyWeight: ReportFacts['bodyWeight']): GoalProgress {
    const bw = bodyWeight.latestKg
    const share = (kg: number | null) => (kg != null && bw ? round2(kg / bw) : null)
    if (target.kind === 'lift' && target.exerciseId) {
        const id = target.exerciseId
        const now = inputs.sets.filter((s) => s.exerciseId === id && windowOf(s.date) === 0)
        const days = new Set(now.map((s) => s.date)).size
        // A reps goal at body weight (a first pull-up, 10 pull-ups): reps, and what leads to it
        if (target.loadKg == null && target.reps != null) {
            const bodyweightReps = now.filter((s) => s.weightKg === 0 && s.assistKg == null).map((s) => s.reps)
            const byId = new Map(inputs.exercises.map((e) => [e.id, e]))
            const logged = [...new Set(inputs.sets.map((s) => s.exerciseId))].map((x) => byId.get(x)).filter((e): e is ExerciseInfo => !!e && e.id !== id)
            const base = String(target.name ?? '').toLowerCase().replace(/s$/, '')
            // The assisted version of the same exercise: the least assist in the latest window with any
            const assistedEx = logged.find((e) => e.logType === 'assisted' && base && e.name.toLowerCase().includes(base))
            let assisted: GoalProgress['assisted'] = null
            if (assistedEx) {
                const own = inputs.sets.filter((s) => s.exerciseId === assistedEx.id && s.assistKg != null && windowOf(s.date) >= 0)
                const latest = own.length ? Math.min(...own.map((s) => windowOf(s.date))) : null
                const inLatest = own.filter((s) => windowOf(s.date) === latest)
                if (inLatest.length) {
                    const best = inLatest.reduce((a, b) => (b.assistKg! < a.assistKg! || (b.assistKg === a.assistKg && b.reps > a.reps) ? b : a))
                    assisted = { exerciseId: assistedEx.id, name: assistedEx.name, nameZh: assistedEx.nameZh, assistKg: best.assistKg!, reps: best.reps, bodyWeightShare: bw ? round2((bw - best.assistKg!) / bw) : null }
                }
            }
            // A first pull-up: the pulldown trained most, against body weight (Johnson 2009)
            let proxy: GoalProgress['proxy'] = null
            if (PULL_UP.test(String(target.name))) {
                const pulldowns = logged.filter((e) => PULLDOWN.test(e.name) && e.logType === 'weight_reps')
                    .map((e) => ({ e, series: e1rmSeries(inputs.sets, e.id, windowOf), n: inputs.sets.filter((s) => s.exerciseId === e.id && windowOf(s.date) >= 0).length }))
                    .filter((x) => latestOf(x.series) != null)
                    .sort((a, b) => b.n - a.n)
                const top = pulldowns[0]
                if (top) {
                    proxy = {
                        exerciseId: top.e.id, name: top.e.name, nameZh: top.e.nameZh, e1rmKg: latestOf(top.series)!, bodyWeightShare: share(latestOf(top.series)),
                        checkpointKg: bw ? round1(bw * PULL_UP_PULLDOWN_SHARE) : null,
                    }
                }
            }
            return { target, days, bestReps: bodyweightReps.length ? Math.max(...bodyweightReps) : null, assisted, proxy }
        }
        // A load goal, or a lift named with no number: its estimated 1RM, then how far the load is.
        // A load for reps (60 kg x 10) is measured as the 1RM it takes.
        const series = e1rmSeries(inputs.sets, id, windowOf)
        const e1rmKg = latestOf(series)
        const goalKg = target.loadKg ? (target.reps && target.reps > 1 ? e1rm({ weightKg: target.loadKg, reps: target.reps }) : target.loadKg) : null
        return { target, days, e1rmKg, share: goalKg && e1rmKg != null ? round2(e1rmKg / goalKg) : null, series, ...seriesChange(series) }
    }
    if (target.kind === 'body_weight') {
        const { change, changeWindows } = seriesChange(bodyWeight.series)
        const first = bodyWeight.series.find((v) => v != null)
        const weeks = changeWindows != null ? (changeWindows * (daysBetween(inputs.periodStart, inputs.periodEnd) + 1)) / 7 : null
        return {
            target, latestKg: bw, series: bodyWeight.series, change, changeWindows,
            ratePerWeek: change != null && first && weeks ? round2((change / first) * 100 / weeks) : null,
        }
    }
    if (target.kind === 'body_fat') {
        const entries = inputs.bodyFat ?? []
        const series = Array.from({ length: WINDOWS }, (_, k) => {
            const inK = entries.filter((x) => windowOf(x.date) === k).map((x) => x.pct)
            return inK.length ? round1(inK.reduce((a, b) => a + b, 0) / inK.length) : null
        }).reverse()
        const latest = [...entries].filter((x) => windowOf(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
        return { target, latestPct: latest?.pct ?? null, series, ...seriesChange(series) }
    }
    // focus: the weekly sets of each unit the goal names
    return { target, muscles: (target.units ?? []).map((group) => ({ group, perWeek: muscles.find((m) => m.group === group)?.perWeek ?? 0 })) }
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
        intensity: cardioIntensity(cardio, inputs.age ?? null, perWeek),
        trends: cardioTrends(inputs.sets.filter((s) => timed(s) && windowOf(s.date) >= 0 && windowOf(s.date) < WINDOWS), byId, windowOf),
    }
}

/**
 * The period's cardio minutes by intensity: each set's average heart rate against the maximum
 * estimated from the age. Without a heart rate or an age a set is unrated, never guessed. The
 * rated minutes are rounded first and unrated is the rest, so the parts add up to the total shown.
 */
function cardioIntensity(cardio: LoggedSet[], age: number | null, perWeek: (minutes: number) => number): CardioIntensityFacts {
    const maxHr = age != null ? maxHeartRate(age) : null
    const seconds = { light: 0, moderate: 0, vigorous: 0 }
    for (const s of cardio) if (s.avgHr != null && maxHr != null) seconds[intensityOf(s.avgHr, maxHr)] += s.durationS ?? 0
    const [light, moderate, vigorous] = [seconds.light, seconds.moderate, seconds.vigorous].map((x) => Math.round(x / 60))
    const total = Math.round(cardio.reduce((a, s) => a + (s.durationS ?? 0), 0) / 60)
    const rated = light + moderate + vigorous
    return {
        light, moderate, vigorous,
        unrated: Math.max(0, total - rated),
        maxHr,
        equivalentPerWeek: rated > 0 ? perWeek(moderateEquivalent(moderate, vigorous)) : null,
        needsAge: maxHr == null && cardio.some((s) => s.avgHr != null),
    }
}

/** A set this short is mostly the heart rate still rising, so it says little about fitness */
const TREND_MIN_SECONDS = 10 * 60
const MAX_TRENDS = 3

/**
 * Machine settings done again with a heart rate: the same treadmill speed and incline, or the same
 * level, in this period and in an earlier one of the lookback. Each day's heart rate is the
 * time-weighted average of its sets at that setting of 10 minutes or more. A rower's pace and a
 * jump rope have no setting to hold fixed, so they aren't compared.
 */
function cardioTrends(sets: LoggedSet[], byId: Map<string, ExerciseInfo>, windowOf: (date: string) => number): CardioTrendFacts[] {
    const settingOf = (s: LoggedSet, logType: LogType) =>
        logType === 'treadmill' && s.speedKmh != null && s.inclinePct != null ? { speedKmh: s.speedKmh, inclinePct: s.inclinePct, level: null }
            : logType === 'cardio_level' && s.level != null ? { speedKmh: null, inclinePct: null, level: s.level }
                : null
    const groups = new Map<string, { exercise: ExerciseInfo; setting: NonNullable<ReturnType<typeof settingOf>>; days: Map<string, { seconds: number; beats: number }> }>()
    for (const s of sets) {
        const e = byId.get(s.exerciseId)
        if (!e || s.avgHr == null || (s.durationS ?? 0) < TREND_MIN_SECONDS) continue
        const setting = settingOf(s, e.logType)
        if (!setting) continue
        const key = `${e.id}|${setting.speedKmh}|${setting.inclinePct}|${setting.level}`
        const group = groups.get(key) ?? { exercise: e, setting, days: new Map() }
        const day = group.days.get(s.date) ?? { seconds: 0, beats: 0 }
        day.seconds += s.durationS!
        day.beats += s.avgHr * s.durationS!
        group.days.set(s.date, day)
        groups.set(key, group)
    }
    return [...groups.values()].flatMap(({ exercise: e, setting, days }) => {
        const dates = [...days.keys()].sort()
        const last = dates.at(-1)!
        if (windowOf(last) !== 0 || windowOf(dates[0]) === 0) return []
        const hr = (date: string) => Math.round(days.get(date)!.beats / days.get(date)!.seconds)
        return [{
            exerciseId: e.id, name: e.name, nameZh: e.nameZh, logType: e.logType, ...setting,
            first: { date: dates[0], avgHr: hr(dates[0]) },
            last: { date: last, avgHr: hr(last) },
            sessions: dates.length,
        }]
    }).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)).slice(0, MAX_TRENDS)
}

function liftFacts(e: ExerciseInfo, allSets: LoggedSet[], windowOf: (date: string) => number, goal: string | null, userExercises: ExerciseInfo[], unit: 'kg' | 'lb'): LiftFacts {
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
    // A weighted lift is also up by double progression, as its plan goes (lib/report/progression.ts
    // plansThrough): the next weight lifted within the range in force, though its estimated 1RM
    // reads lower (80 x 8 to 82.5 x 6 is -2.3%), or more reps on the same weight's sets (8, 7, 6 to
    // 8, 8, 8, whose best set is the same)
    const plans = exact ? null : plansThrough(e, sets, unit, windowOf)
    const tops = Array.from({ length: WINDOWS }, (_, k) => (exact ? null : topSession(sets.filter((s) => windowOf(s.date) === k))))
    const progressed = (k: number, j: number): LiftFacts['progress'] | null => {
        const a = tops[k]
        const b = tops[j]
        if (!a || !b || a.weightKg < b.weightKg) return null
        if (a.weightKg > b.weightKg) return Math.max(...a.reps) >= (plans?.[j]?.low ?? Infinity) ? 'heavier' : null
        const now = [...a.reps].sort((x, y) => y - x)
        const before = [...b.reps].sort((x, y) => y - x)
        const pairs = now.slice(0, before.length).map((r, i) => r - before[i])
        return pairs.some((d) => d > 0) && pairs.every((d) => d >= 0) ? 'more_reps' : null
    }
    // Window k against an earlier window j: by its best set, else by the plan
    const byBest = (k: number, j: number) => {
        const a = bests[k]!
        const b = bests[j]!
        return exact ? value(a) > value(b) : outlifts(a, b) || value(a) > value(b) * (1 + FLAT_BAND)
    }
    const beats = (k: number, j: number) => byBest(k, j) || (!exact && !!progressed(k, j))
    const lower = (now: number, before: number, k: number, j: number) => (exact ? now < before : !progressed(k, j) && now < before * (1 - FLAT_BAND))
    let trend: LiftFacts['trend'] = 'new'
    let change: number | null = null
    let progress: LiftFacts['progress'] | null = null
    if (bests[0] && prev) {
        const now = value(bests[0])
        const before = value(prev)
        // Said only where the best set doesn't show it
        progress = exact || byBest(0, prevIndex) ? null : progressed(0, prevIndex)
        change = assisted || added ? null : bodyweight ? now - before : round1(((now - before) / before) * 100)
        // Up by the plan, not by the estimate: no minus sign beside it
        if (progress && change != null && change < 0) change = null
        trend = beats(0, prevIndex) ? 'up' : lower(now, before, 0, prevIndex) ? 'down' : 'flat'
    }

    // Walk the trained windows oldest first. A run is measured from the best it started at, not the
    // best so far: small steady gains each stay inside the band, but they add up past it.
    const trainedWindows = bests.flatMap((b, k) => (b ? [k] : [])).reverse()
    let flatWindows = 0
    let from = trainedWindows[0]
    for (const k of trainedWindows.slice(1)) {
        if (beats(k, from)) {
            flatWindows = 0
            from = k
        } else flatWindows++
    }
    // Then newest first, each against the trained window before it
    const valueAt = (k: number) => series[WINDOWS - 1 - k]!
    let downWindows = 0
    for (let i = trainedWindows.length - 1; i > 0; i--) {
        const k = trainedWindows[i]
        const j = trainedWindows[i - 1]
        if (!lower(valueAt(k), valueAt(j), k, j)) break
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
        ...(tops[0] ? { top: tops[0] } : {}),
        ...(prev && tops[prevIndex] ? { previousTop: tops[prevIndex]! } : {}),
        ...(progress ? { progress } : {}),
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
