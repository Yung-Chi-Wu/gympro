import { addDays, daysBetween } from '../../../../lib/periods'
import { hasTarget, setWeights, VOLUME_UNIT_IDS } from '../../../../lib/report/volume'
import type { BestSet, ExerciseInfo, LiftFacts, LoggedSet, MuscleFacts, RecordFacts, ReportFacts, ReportInputs, ReportStatus } from './types'

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
const MAIN_LIFTS = 5

/** Estimated one-rep max (Epley). */
export const e1rm = (s: BestSet) => s.weightKg * (1 + s.reps / 30)
const round1 = (n: number) => Math.round(n * 10) / 10

/** Which window a date falls in: 0 for this period, 1 for the one before, -1 after it. */
export function windowOfFor(periodStart: string, periodEnd: string) {
    const days = daysBetween(periodStart, periodEnd) + 1
    return (date: string) => {
        const back = daysBetween(date, periodEnd)
        return back < 0 ? -1 : Math.floor(back / days)
    }
}

/** One exercise's facts, for following up a lift that may no longer be a main lift. */
export function liftFor(inputs: ReportInputs, exerciseId: string): LiftFacts | null {
    const e = inputs.exercises.find((x) => x.id === exerciseId)
    if (!e) return null
    const windowOf = windowOfFor(inputs.periodStart, inputs.periodEnd)
    return inputs.sets.some((s) => s.exerciseId === exerciseId && windowOf(s.date) === 0) ? liftFacts(e, inputs.sets, windowOf, inputs.goal) : null
}

export function computeFacts(inputs: ReportInputs): ReportFacts {
    const { periodStart, periodEnd } = inputs
    const days = daysBetween(periodStart, periodEnd) + 1
    const windowOf = windowOfFor(periodStart, periodEnd)
    const inWindow = (k: number) => inputs.sets.filter((s) => windowOf(s.date) === k)
    const current = inWindow(0)
    const byId = new Map(inputs.exercises.map((e) => [e.id, e]))
    const hasHistory = inputs.sets.some((s) => s.date < periodStart)

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
    const trainedNow = [...new Set(current.map((s) => s.exerciseId))].map((id) => byId.get(id)).filter((e): e is ExerciseInfo => !!e && !NOT_LIFTS.has(e.muscleGroup))
    const allLifts = trainedNow.map((e) => liftFacts(e, inputs.sets, windowOf, inputs.goal))
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
        const earlier = inputs.sets.filter((s) => s.exerciseId === lift.exerciseId && s.date < periodStart)
        if (!earlier.length || !lift.best) continue
        const value = (s: BestSet) => (lift.bodyweight ? s.reps : e1rm(s))
        const before = Math.max(...earlier.map((s) => value(s)))
        if (value(lift.best) > before) {
            const set = current.find((s) => s.exerciseId === lift.exerciseId && s.reps === lift.best!.reps && s.weightKg === lift.best!.weightKg)!
            records.push({ exerciseId: lift.exerciseId, name: lift.name, nameZh: lift.nameZh, best: lift.best, bodyweight: lift.bodyweight, date: set.date })
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
        totalSets: { now: current.length, previous: hasHistory ? inWindow(1).length : null },
        muscles,
        lifts,
        records,
        bodyWeight: bodyWeightFacts(inputs.weighIns, windowOf),
        status,
        liftsSummary,
        goal: { text: inputs.goal, direction: goalDirection },
    }
}

function liftFacts(e: ExerciseInfo, allSets: LoggedSet[], windowOf: (date: string) => number, goal: string | null): LiftFacts {
    const sets = allSets.filter((s) => s.exerciseId === e.id)
    const bodyweight = sets.every((s) => s.weightKg === 0)
    const value = (s: BestSet) => (bodyweight ? s.reps : e1rm(s))
    const bestIn = (k: number) => {
        const inK = sets.filter((s) => windowOf(s.date) === k)
        return inK.length ? inK.reduce((a, b) => (value(b) > value(a) ? b : a)) : null
    }
    const bests = Array.from({ length: WINDOWS }, (_, k) => bestIn(k))
    const series = bests.map((b) => (b ? round1(value(b)) : null)).reverse()
    const best = bests[0] ? { weightKg: bests[0].weightKg, reps: bests[0].reps } : null
    const prevIndex = bests.findIndex((b, k) => k > 0 && b)
    const prev = prevIndex > 0 ? bests[prevIndex]! : null

    let trend: LiftFacts['trend'] = 'new'
    let change: number | null = null
    if (best && prev) {
        const now = value(best)
        const before = value(prev)
        change = bodyweight ? now - before : round1(((now - before) / before) * 100)
        const up = bodyweight ? now > before : now > before * (1 + FLAT_BAND)
        const down = bodyweight ? now < before : now < before * (1 - FLAT_BAND)
        trend = up ? 'up' : down ? 'down' : 'flat'
    }

    // Walk the trained windows oldest first
    const trained = series.filter((v): v is number => v != null)
    const beats = (v: number, max: number) => (bodyweight ? v > max : v > max * (1 + FLAT_BAND))
    let flatWindows = 0
    let max = trained[0] ?? 0
    for (const v of trained.slice(1)) {
        if (beats(v, max)) flatWindows = 0
        else flatWindows++
        max = Math.max(max, v)
    }
    let downWindows = 0
    for (let i = trained.length - 1; i > 0; i--) {
        const lower = bodyweight ? trained[i] < trained[i - 1] : trained[i] < trained[i - 1] * (1 - FLAT_BAND)
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
        previousBest: prev ? { weightKg: prev.weightKg, reps: prev.reps } : null,
        bodyweight,
        series,
        trend,
        change,
        flatWindows: best ? flatWindows : 0,
        downWindows,
        goalLift: goalMentions(goal, e),
    }
}

function bodyWeightFacts(weighIns: ReportInputs['weighIns'], windowOf: (date: string) => number): ReportFacts['bodyWeight'] {
    const avg = (k: number) => {
        const w = weighIns.filter((x) => windowOf(x.date) === k).map((x) => x.weightKg)
        return w.length ? round1(w.reduce((a, b) => a + b, 0) / w.length) : null
    }
    const byWindow = Array.from({ length: WINDOWS }, (_, k) => avg(k))
    const latest = [...weighIns].filter((x) => windowOf(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
    const lastBefore = byWindow.slice(1).find((v) => v != null) ?? null

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
        weighIns: weighIns.filter((x) => windowOf(x.date) === 0).length,
        series: byWindow.slice().reverse(),
        trendWindows: byWindow[0] == null ? 0 : trendWindows,
    }
}

// ---------- The goal, read from free text ----------

const GAIN = /增肌|增重|長肌肉|練大|bulk|gain|build muscle|put on/i
const LOSE = /減脂|減重|減肥|瘦|fat loss|lose|cut|lean/i

export function goalDirectionOf(goal: string | null): 'gain' | 'lose' | null {
    if (!goal) return null
    const gain = GAIN.test(goal)
    const lose = LOSE.test(goal)
    return gain && !lose ? 'gain' : lose && !gain ? 'lose' : null
}

const EQUIPMENT_ZH = /^(槓鈴|啞鈴|繩索|器械|史密斯|壺鈴)/
const EQUIPMENT_EN = /^(barbell|dumbbell|cable|machine|smith machine|kettlebell)\s+/i

/** Whether the goal names this exercise, with or without its equipment ("臥推" names 槓鈴臥推). */
export function goalMentions(goal: string | null, e: ExerciseInfo): boolean {
    if (!goal) return false
    const text = goal.toLowerCase()
    const names = [e.name.toLowerCase(), e.name.toLowerCase().replace(EQUIPMENT_EN, '')]
    if (e.nameZh) names.push(e.nameZh, e.nameZh.replace(EQUIPMENT_ZH, ''))
    return names.some((n) => n.length >= 2 && text.includes(n))
}
