import { analyze } from '../../src/report/analyze'
import { liftFor } from '../../src/report/facts'
import { planNext, REPORT_WINDOWS, stepOf, windowOfFor, type Prescription } from '../../../../lib/report/progression'
import { MINIMUM_SETS_FOR_ADVICE, type ExerciseInfo, type Finding, type GoalRead, type LoggedSet, type ReportFacts, type ReportInputs } from '../../../../lib/report/types'
import { addDays } from '../../../../lib/periods'
import { toStorageKg } from '../../../../lib/weight-unit'

// The weekly report's code, run again on past weeks of real logs and checked against what the
// user did after (owner, 2026-11-04). Each week is read as the report would have read it then:
// fetch.ts reads only what was logged by the week's end. The code is today's, so the numbers say
// how today's rules would have done. No model is called: the goal is the read kept with the
// profile, and nothing the user said in a week is read, so no tired or pain signal fires.
// Three of the report's decisions are checked:
//   plans        each weighted main lift's next session (planNext, as the report and Today give
//                it): was it lifted at the next session, and were the reps there
//   regressions  a lift read as regressed: was it still below its level a week or two later, or
//                back (the drop didn't last); and the same for any drop at all, the plainest rule
//   stalls       a lift read as stalled: did it beat its best in the next two weeks
// Run on real accounts by scripts/backtest-report.ts; checked on users made up with known
// answers by check-backtest.mjs.

/** Weeks after a flag in which its outcome is looked for */
export const HORIZON_WEEKS = 2

/** One past week as the report would have read it then */
export interface PastWeek {
    inputs: ReportInputs
    /** The goal as read, kept with the profile: the backtest reads no goal (no model call) */
    goalRead: GoalRead | null
}

/** A weighted main lift's next session, as the week planned it */
export interface Plan {
    exercise: ExerciseInfo
    rx: Prescription
}

/** What the report's code decided for one week */
export interface WeekDecisions {
    periodStart: string
    periodEnd: string
    /** Sets enough for advice: a week below gets its numbers alone, and no rule or plan */
    advice: boolean
    facts: ReportFacts
    findings: Finding[]
    /** None in a lighter week, whose plan is a deload's (deloadOf), not a step */
    plans: Plan[]
    /** This week's own sets, which an earlier week's plan is checked against */
    sets: LoggedSet[]
    weightUnit: 'kg' | 'lb'
    /** The week as read, for a lift's value that week though it is no main lift (liftFor) */
    inputs: ReportInputs
}

/**
 * The weeks in order, each with the previous one's findings to follow up, as the report reads the
 * last report: a week without advice leaves none.
 */
export function replay(weeks: PastWeek[]): WeekDecisions[] {
    const out: WeekDecisions[] = []
    let previous: Finding[] | null = null
    for (const { inputs: read, goalRead } of weeks) {
        const inputs: ReportInputs = { ...read, previousFindings: previous, goalRead }
        const { facts, findings } = analyze(inputs)
        const advice = facts.totalSets.now >= MINIMUM_SETS_FOR_ADVICE
        const unit = inputs.weightUnit ?? 'kg'
        const windowOf = windowOfFor(inputs.periodStart, inputs.periodEnd)
        const lighter = findings.some((f) => f.rule === 'deload')
        const plans = advice && !lighter ? facts.lifts.flatMap((l): Plan[] => {
            const exercise = inputs.exercises.find((e) => e.id === l.exerciseId)
            const rx = exercise ? planNext(exercise, inputs.sets, unit, windowOf) : null
            return exercise && rx && (rx.how === 'load' || rx.how === 'load_now') ? [{ exercise, rx }] : []
        }) : []
        out.push({
            periodStart: inputs.periodStart, periodEnd: inputs.periodEnd, advice, facts, findings: advice ? findings : [], plans,
            sets: inputs.sets.filter((s) => s.date >= inputs.periodStart && s.date <= inputs.periodEnd), weightUnit: unit, inputs,
        })
        previous = advice ? findings : null
    }
    return out
}

/**
 * Weeks of inputs from one list of sets, chosen as fetch.ts chooses them: the lookback windows,
 * and every earlier set of the exercises trained in the week. For users made up in a check; real
 * accounts are read by fetch.ts itself.
 */
export function weeksFrom(sets: LoggedSet[], base: Omit<ReportInputs, 'periodStart' | 'periodEnd' | 'sets' | 'previousFindings'>, firstWeek: string, count: number): PastWeek[] {
    return Array.from({ length: count }, (_, i) => {
        const periodStart = addDays(firstWeek, 7 * i)
        const periodEnd = addDays(periodStart, 6)
        const lookbackStart = addDays(periodStart, -7 * (REPORT_WINDOWS - 1))
        const trained = new Set(sets.filter((s) => s.date >= periodStart && s.date <= periodEnd).map((s) => s.exerciseId))
        const read = sets.filter((s) => s.date <= periodEnd && (s.date >= lookbackStart || trained.has(s.exerciseId)))
        return { inputs: { ...base, periodStart, periodEnd, sets: read, previousFindings: null }, goalRead: base.goalRead ?? null }
    })
}

/** Why an outcome couldn't be scored: the logs end too soon after it, or the lift wasn't done again in time */
export type Unseen = 'ended' | 'not_trained'

export interface PlanOutcome {
    periodEnd: string
    exerciseId: string
    how: 'load' | 'load_now'
    /** The weight planned for the next session: the plan's own, or the step after it when the reps are high (load_now) */
    targetKg: number
    /** The plan moves to a heavier weight than was lifted: all the reps were there, or they are high */
    stepUp: boolean
    low: number
    top: number
    /** The next session's heaviest weight; null when the lift wasn't done again before the logs end */
    doneKg: number | null
    followed: 'same' | 'heavier' | 'lighter' | null
    /** Lifted at the planned weight: every set there reached the range's bottom; null for load_now, which names no range for the next weight */
    hit: boolean | null
    /** And every set there reached the top: the next step was due already */
    topped: boolean | null
    /** Not done again: the plan's week is the last one, or the lift wasn't done in any week after */
    unseen?: Unseen
}

export interface FlagOutcome {
    periodEnd: string
    exerciseId: string
    /** The lift's level before the drop, or its best before the stall */
    before: number
    value: number
    /** The next trained week's value within HORIZON_WEEKS (a stall: the best of them); null when it wasn't trained in time */
    next: number | null
    /** A drop: back at the level before it. A stall: above its best */
    passed: boolean | null
    unseen?: Unseen
}

export interface Outcomes {
    plans: PlanOutcome[]
    regressions: FlagOutcome[]
    drops: FlagOutcome[]
    stalls: FlagOutcome[]
}

/** The first session of an exercise after week k: its sets on the first later day it was done */
function nextSession(weeks: WeekDecisions[], k: number, exerciseId: string): LoggedSet[] | null {
    for (const w of weeks.slice(k + 1)) {
        const own = w.sets.filter((s) => s.exerciseId === exerciseId).sort((a, b) => a.date.localeCompare(b.date) || a.loggedAt.localeCompare(b.loggedAt))
        if (own.length) return own.filter((s) => s.date === own[0].date)
    }
    return null
}

/**
 * A lift's value in each of the weeks after week k, while they are within the horizon: from its
 * own sets, as a follow-up reads a lift (liftFor), so a week it was trained but wasn't a main lift
 * still counts
 */
function laterValues(weeks: WeekDecisions[], k: number, exerciseId: string): number[] {
    return weeks.slice(k + 1, k + 1 + HORIZON_WEEKS).flatMap((w) => {
        const v = liftFor(w.inputs, exerciseId)?.series.at(-1)
        return v == null ? [] : [v]
    })
}

/** No value to score by: the logs end before the horizon does, or the lift wasn't trained within it */
const unseenAfter = (weeks: WeekDecisions[], k: number): Unseen => (weeks.length - 1 - k < HORIZON_WEEKS ? 'ended' : 'not_trained')

export function score(weeks: WeekDecisions[]): Outcomes {
    const out: Outcomes = { plans: [], regressions: [], drops: [], stalls: [] }
    weeks.forEach((w, k) => {
        for (const { exercise: e, rx } of w.plans) {
            const how = rx.how as 'load' | 'load_now'
            const targetKg = how === 'load_now' ? rx.nextKg! : rx.weightKg
            // Within half a step is the same weight: a plate or a unit's rounding apart
            const near = toStorageKg(stepOf(e, w.weightUnit), w.weightUnit) / 2
            const session = nextSession(weeks, k, e.id)
            const weighted = (session ?? []).filter((s) => s.weightKg > 0)
            const doneKg = weighted.length ? Math.max(...weighted.map((s) => s.weightKg)) : null
            const followed = doneKg == null ? null : Math.abs(doneKg - targetKg) < near ? 'same' : doneKg > targetKg ? 'heavier' : 'lighter'
            const at = weighted.filter((s) => Math.abs(s.weightKg - targetKg) < near)
            const ranged = followed === 'same' && how === 'load'
            out.plans.push({
                periodEnd: w.periodEnd, exerciseId: e.id, how, targetKg, stepUp: how === 'load_now' || rx.fromKg != null, low: rx.low, top: rx.top, doneKg, followed,
                hit: ranged ? at.every((s) => s.reps >= rx.low) : null,
                topped: ranged ? at.every((s) => s.reps >= rx.top) : null,
                ...(doneKg == null ? { unseen: k === weeks.length - 1 ? 'ended' as const : 'not_trained' as const } : {}),
            })
        }
        if (!w.advice) return
        for (const l of w.facts.lifts) {
            const value = l.series.at(-1)
            if (value == null) continue
            const later = laterValues(weeks, k, l.exerciseId)
            const flagged = w.findings.find((f) => f.rule === 'lift_regressed' && f.subject === l.exerciseId)
            const before = typeof flagged?.data.previousValue === 'number' ? flagged.data.previousValue : null
            const unseen = later.length ? {} : { unseen: unseenAfter(weeks, k) }
            if (flagged && before != null) out.regressions.push({ periodEnd: w.periodEnd, exerciseId: l.exerciseId, before, value, next: later[0] ?? null, passed: later.length ? later[0] >= before : null, ...unseen })
            // The plainest rule: any week lower than the last trained one
            const last = l.series.slice(0, -1).filter((v): v is number => v != null).at(-1)
            if (last != null && value < last) out.drops.push({ periodEnd: w.periodEnd, exerciseId: l.exerciseId, before: last, value, next: later[0] ?? null, passed: later.length ? later[0] >= last : null, ...unseen })
            if (w.findings.some((f) => f.rule === 'lift_stalled' && f.subject === l.exerciseId)) {
                const best = Math.max(...l.series.filter((v): v is number => v != null))
                const next = later.length ? Math.max(...later) : null
                out.stalls.push({ periodEnd: w.periodEnd, exerciseId: l.exerciseId, before: best, value, next, passed: next == null ? null : next > best, ...unseen })
            }
        }
    })
    return out
}

/** Counts, so the accounts' summaries add up and nothing of a user is kept */
export interface Summary {
    accounts: number
    weeks: number
    adviceWeeks: number
    /** ended and notTrained: the outcomes not scored, by why (Unseen) */
    plans: { planned: number; doneAgain: number; same: number; heavier: number; lighter: number; ranged: number; hit: number; topped: number; stepUps: number; stepUpsSame: number; ended: number; notTrained: number }
    regressions: { flagged: number; seen: number; back: number; ended: number; notTrained: number }
    drops: { flagged: number; seen: number; back: number; ended: number; notTrained: number }
    stalls: { flagged: number; seen: number; beat: number; ended: number; notTrained: number }
}

export function summarize(weeks: WeekDecisions[], o: Outcomes): Summary {
    const unseen = (list: { unseen?: Unseen }[]) => ({ ended: list.filter((x) => x.unseen === 'ended').length, notTrained: list.filter((x) => x.unseen === 'not_trained').length })
    const flags = (list: FlagOutcome[]) => ({ flagged: list.length, seen: list.filter((x) => x.passed != null).length, passed: list.filter((x) => x.passed).length, ...unseen(list) })
    const r = flags(o.regressions)
    const d = flags(o.drops)
    const s = flags(o.stalls)
    const done = o.plans.filter((p) => p.followed != null)
    return {
        accounts: 1,
        weeks: weeks.length,
        adviceWeeks: weeks.filter((w) => w.advice).length,
        plans: {
            planned: o.plans.length,
            doneAgain: done.length,
            same: done.filter((p) => p.followed === 'same').length,
            heavier: done.filter((p) => p.followed === 'heavier').length,
            lighter: done.filter((p) => p.followed === 'lighter').length,
            ranged: o.plans.filter((p) => p.hit != null).length,
            hit: o.plans.filter((p) => p.hit).length,
            topped: o.plans.filter((p) => p.topped).length,
            stepUps: done.filter((p) => p.stepUp).length,
            stepUpsSame: done.filter((p) => p.stepUp && p.followed === 'same').length,
            ...unseen(o.plans),
        },
        regressions: { flagged: r.flagged, seen: r.seen, back: r.passed, ended: r.ended, notTrained: r.notTrained },
        drops: { flagged: d.flagged, seen: d.seen, back: d.passed, ended: d.ended, notTrained: d.notTrained },
        stalls: { flagged: s.flagged, seen: s.seen, beat: s.passed, ended: s.ended, notTrained: s.notTrained },
    }
}

/** Accounts' summaries added up */
export function addUp(all: Summary[]): Summary {
    const sum = (pick: (s: Summary) => Record<string, number>) => {
        const out: Record<string, number> = {}
        for (const s of all) for (const [k, v] of Object.entries(pick(s))) out[k] = (out[k] ?? 0) + v
        return out
    }
    const top = sum((s) => ({ accounts: s.accounts, weeks: s.weeks, adviceWeeks: s.adviceWeeks }))
    return {
        accounts: top.accounts ?? 0, weeks: top.weeks ?? 0, adviceWeeks: top.adviceWeeks ?? 0,
        plans: sum((s) => s.plans) as Summary['plans'],
        regressions: sum((s) => s.regressions) as Summary['regressions'],
        drops: sum((s) => s.drops) as Summary['drops'],
        stalls: sum((s) => s.stalls) as Summary['stalls'],
    }
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '-')
const notScored = (x: { ended: number; notTrained: number }) => (x.ended + x.notTrained ? `; not scored: ${x.ended} as the logs end, ${x.notTrained} not trained again in time` : '')

/** The summary as lines to read, rates with the counts they come from */
export function summaryLines(s: Summary): string[] {
    const p = s.plans
    return [
        `${s.accounts} account(s), ${s.weeks} weeks replayed, ${s.adviceWeeks} with advice`,
        '',
        `Next-session plans: ${p.planned} planned, ${p.doneAgain} done again${notScored(p)}`,
        `  lifted at the planned weight  ${pct(p.same, p.doneAgain)} (${p.same}/${p.doneAgain}); heavier ${p.heavier}, lighter ${p.lighter}`,
        `  at it, every set in range     ${pct(p.hit, p.ranged)} (${p.hit}/${p.ranged})`,
        `  at it, every set at the top   ${pct(p.topped, p.ranged)} (${p.topped}/${p.ranged})  (the step was due already)`,
        `  step-ups lifted as planned    ${pct(p.stepUpsSame, p.stepUps)} (${p.stepUpsSame}/${p.stepUps})`,
        '',
        `Regressions flagged: ${s.regressions.flagged}; back to the level before within ${HORIZON_WEEKS} weeks ${pct(s.regressions.back, s.regressions.seen)} (${s.regressions.back}/${s.regressions.seen})${notScored(s.regressions)}`,
        `Any drop (plainest rule): ${s.drops.flagged}; back within ${HORIZON_WEEKS} weeks ${pct(s.drops.back, s.drops.seen)} (${s.drops.back}/${s.drops.seen})${notScored(s.drops)}`,
        `Stalls flagged: ${s.stalls.flagged}; beat their best within ${HORIZON_WEEKS} weeks ${pct(s.stalls.beat, s.stalls.seen)} (${s.stalls.beat}/${s.stalls.seen})${notScored(s.stalls)}`,
    ]
}
