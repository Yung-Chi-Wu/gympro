import { display, kgOf, prescribe, roundToStep, stepOf, type Prescription } from '../../../../lib/report/progression'
import { e1rm, liftFor, windowOfFor } from './facts'
import type { ExerciseInfo, Finding, GoalProgress, GoalTarget, LiftFacts, ReportFacts, ReportInputs, RuleId, WeekSignal } from './types'

// What to do next session, worked out by code and written by code (lib/report/report-text.ts
// planItems): the model never writes these numbers. The owner's report said only "add sets",
// tied to nothing he was after (2026-10-20), so a report now starts from the lifts:
//   goal_path     each lift the goal names: the next session the way the user trains it now,
//                 then other ways that research supports, for the user to choose between
//   next_session  the other main lifts, one line each; without a goal it is the whole advice
//   pain_hold     a lift the user said hurt this period: no more weight on it this period
// Each starts from double progression (Plotkin 2022; ACSM 2009): keep the weight and add reps
// until every set reaches the top of the range, then add the smallest step. The range is the
// user's own: the fewest reps of their heaviest sets, up to two more.
//
// What the user told Ronnie and wrote this period changes the plan: a lift that hurt this period
// is held; an injury Ronnie keeps rules out the heavier options on a lift that loads that joint;
// an exercise they don't want is never suggested.
//
// A lighter week (a deload) replaces the plan: each main lift's numbers for it go under the
// deload's advice, and nothing says to add weight. A plan the user isn't keeping up with (under
// 3 in 4 sessions done two periods running) offers no extra day.

/** Heavier sets for a strength goal: above about 80% of 1RM (Currier 2023), here 85% for 4-6 reps */
const HEAVY_SHARE = 0.85
/** A second, lighter day of a lift trained once: 3 sets of 5 at 75% of its estimated 1RM */
const SECOND_DAY_SHARE = 0.75
/** Reps of the pulldown set that marks the try at a first pull-up */
const TRY_REPS = 6
/** The other main lifts given a line each */
const MAX_NEXT_LINES = 3
/** A goal lift's run without a new best that calls for a reset rather than more of the same (rules.ts STALL_WINDOWS) */
const STALL_WINDOWS = 3
/** Taken off a stalled lift before building back up: 10% (the stall ladder's second step) */
const STALL_DROP = 0.1
/**
 * A lighter week: about 10% off the weight and half the sets, the same days and exercises
 * (Rogerson 2024: athletes deload with fewer sets and lighter loads, keeping both). GymPro's numbers.
 */
const DELOAD_DROP = 0.1

const PRIORITY: Partial<Record<RuleId, number>> = { pain_hold: 90, goal_path: 65, next_session: 55 }

const PULL_UP = /pull-?up|chin-?up/i
const PULLDOWN = /pulldown|pull-down/i

interface Context {
    inputs: ReportInputs
    facts: ReportFacts
    unit: 'kg' | 'lb'
    windowOf: (date: string) => number
    library: ExerciseInfo[]
    disliked: Set<string>
    /** Joints Ronnie's notes have an active injury on, with the note */
    injuries: Map<string, { text: string; date: string }>
    pains: WeekSignal[]
    /** Under 3 in 4 planned sessions done two periods running (rules.ts): no option that adds a day */
    shrink: boolean
}

const rxData = (rx: Prescription) => ({
    how: rx.how, weightKg: rx.weightKg, low: rx.low, top: rx.top, nextKg: rx.nextKg, assistKg: rx.assistKg, sets: rx.sets,
})

/** The pain this period that bears on a lift: about it by name, or in a joint it loads more than lightly */
function painFor(e: ExerciseInfo, pains: WeekSignal[]): WeekSignal | null {
    return pains.find((p) => p.exerciseId === e.id)
        ?? pains.find((p) => p.joint && !p.exerciseId && (e.jointLoad?.[p.joint] === 'medium' || e.jointLoad?.[p.joint] === 'high'))
        ?? null
}
/** An injury in Ronnie's notes on a joint the lift loads more than lightly */
function injuryFor(e: ExerciseInfo, injuries: Context['injuries']): { joint: string; text: string; date: string } | null {
    for (const [joint, note] of injuries) {
        const load = e.jointLoad?.[joint]
        if (load === 'medium' || load === 'high') return { joint, ...note }
    }
    return null
}
/** Another exercise for the same muscles that loads the joint lightly, one the user doesn't mind */
function alternativeFor(e: ExerciseInfo, joint: string | undefined, ctx: Context): ExerciseInfo | null {
    if (!joint || !e.primaryMuscles.length) return null
    return ctx.library.find((x) => x.id !== e.id && !ctx.disliked.has(x.id) && x.jointLoad?.[joint] === 'low'
        && (x.logType === 'weight_reps' || x.logType === 'bodyweight') && x.primaryMuscles[0] === e.primaryMuscles[0]) ?? null
}

/** A weight for a share of the estimated 1RM, on the step, in kg */
function shareOf(e1rmKg: number, share: number, e: ExerciseInfo, unit: 'kg' | 'lb'): number {
    const step = stepOf(e, unit)
    return kgOf(roundToStep(display(e1rmKg * share, unit), step), unit)
}
/** The best estimated 1RM this period from sets of up to 10 reps (GOAL_MAX_REPS), else any */
function e1rmNow(e: ExerciseInfo, ctx: Context): number | null {
    const now = ctx.inputs.sets.filter((s) => s.exerciseId === e.id && ctx.windowOf(s.date) === 0 && s.weightKg > 0)
    const fit = now.filter((s) => s.reps <= 10)
    const pool = fit.length ? fit : now
    return pool.length ? Math.max(...pool.map(e1rm)) : null
}

/** An exercise's names in finding data: name and nameZh, or with a prefix and its id (viaId, viaName, viaNameZh) */
const nameData = (e: ExerciseInfo, prefix?: string): Record<string, string> => (prefix
    ? { [`${prefix}Id`]: e.id, [`${prefix}Name`]: e.name, [`${prefix}NameZh`]: e.nameZh ?? e.name }
    : { name: e.name, nameZh: e.nameZh ?? e.name })

function painHold(e: ExerciseInfo, pain: WeekSignal, ctx: Context): Finding | null {
    const rx = prescribe(e, ctx.inputs.sets, ctx.unit, ctx.windowOf)
    if (!rx) return null
    const alt = alternativeFor(e, pain.joint ?? jointOf(e), ctx)
    return finding('pain_hold', e.id, {
        ...nameData(e), ...rxData(rx),
        joint: pain.joint ?? null, painText: pain.text, painDate: pain.date, painSource: pain.source,
        ...(alt ? nameData(alt, 'alt') : { altName: null, altNameZh: null }),
    })
}
/** The joint a lift loads most, for an alternative when the pain named the lift but no joint */
function jointOf(e: ExerciseInfo): string | undefined {
    const loads = Object.entries(e.jointLoad ?? {})
    return (loads.find(([, l]) => l === 'high') ?? loads.find(([, l]) => l === 'medium'))?.[0]
}

function finding(rule: RuleId, subject: string, data: Finding['data']): Finding {
    return { id: `${rule}:${subject}`, rule, subject, priority: PRIORITY[rule] ?? 50, data }
}

/** A goal's lift: the user's next session on it, and the other ways to get there */
function goalPath(target: GoalTarget, progress: GoalProgress | undefined, ctx: Context): Finding | null {
    const e = ctx.inputs.exercises.find((x) => x.id === target.exerciseId) ?? ctx.library.find((x) => x.id === target.exerciseId)
    if (!e) return null
    const strength = (ctx.inputs.goalRead?.kinds ?? []).includes('strength') || target.loadKg != null
    const injury = injuryFor(e, ctx.injuries)
    const base: Finding['data'] = { ...nameData(e), targetKg: target.loadKg ?? null, targetReps: target.reps ?? null, e1rmKg: progress?.e1rmKg ?? null, share: progress?.share ?? null, days: progress?.days ?? null,
        ...(injury ? { injury: injury.text, injuryDate: injury.date } : {}) }

    // A first pull-up the user can't do yet: the way they already train toward it, then the others
    if (target.reps != null && target.loadKg == null && PULL_UP.test(e.name) && progress?.bestReps == null) {
        const assistedEx = ctx.library.find((x) => x.logType === 'assisted' && PULL_UP.test(x.name) && !ctx.disliked.has(x.id))
        // An assisted pull-up left out because the user doesn't want it: the reason says so
        const dislike = assistedEx ? null : (ctx.inputs.memory ?? []).find((n) => n.kind === 'exercise' && n.state === 'dislike' && ctx.library.some((x) => x.id === n.subject && x.logType === 'assisted' && PULL_UP.test(x.name)))
        const pulldownEx = (progress?.proxy && ctx.inputs.exercises.find((x) => x.id === progress.proxy!.exerciseId))
            ?? ctx.library.find((x) => PULLDOWN.test(x.name) && !/close|reverse|single|straight/i.test(x.name) && !ctx.disliked.has(x.id))
        const viaAssisted = progress?.assisted ? ctx.inputs.exercises.find((x) => x.id === progress.assisted!.exerciseId) : undefined
        const research = 'pullUp,progress'
        const told: Finding['data'] = dislike ? { dislike: dislike.text, dislikeDate: dislike.date } : {}
        if (viaAssisted) {
            const rx = prescribe(viaAssisted, ctx.inputs.sets, ctx.unit, ctx.windowOf)
            if (rx) {
                return finding('goal_path', e.id, {
                    ...base, path: 'assisted', ...nameData(viaAssisted, 'via'), ...rxData(rx),
                    options: [pulldownEx && 'pulldown', 'negatives'].filter(Boolean).join(','), ...(pulldownEx ? nameData(pulldownEx, 'pulldown') : {}), research,
                })
            }
        }
        if (progress?.proxy && pulldownEx) {
            const rx = prescribe(pulldownEx, ctx.inputs.sets, ctx.unit, ctx.windowOf)
            if (rx && rx.how !== 'assist') {
                // The pulldown set that estimates the checkpoint, at 6 reps: where a first pull-up likely comes
                const tryAtKg = progress.proxy.checkpointKg ? shareOf(progress.proxy.checkpointKg / (1 + TRY_REPS / 30), 1, pulldownEx, ctx.unit) : null
                return finding('goal_path', e.id, {
                    ...base, ...told, path: 'pulldown', ...nameData(pulldownEx, 'via'), ...rxData(rx), tryAtKg, tryReps: TRY_REPS,
                    proxyShare: progress.proxy.bodyWeightShare, checkpointKg: progress.proxy.checkpointKg, proxyE1rmKg: progress.proxy.e1rmKg,
                    options: [assistedEx && 'assisted', 'negatives'].filter(Boolean).join(','), ...(assistedEx ? nameData(assistedEx, 'assisted') : {}), research,
                })
            }
        }
        // Nothing logged toward it yet: where to start
        return finding('goal_path', e.id, {
            ...base, ...told, path: 'start', ...(pulldownEx ? nameData(pulldownEx, 'via') : {}),
            options: [assistedEx && 'assisted', 'negatives'].filter(Boolean).join(','), ...(assistedEx ? nameData(assistedEx, 'assisted') : {}), research,
        })
    }

    const lift = ctx.facts.lifts.find((l) => l.exerciseId === e.id) ?? liftFor(ctx.inputs, e.id)
    const rx = prescribe(e, ctx.inputs.sets, ctx.unit, ctx.windowOf)
    if (!lift || !rx) {
        // Not trained this period: from the last set logged, or where to begin
        const last = [...ctx.inputs.sets].filter((s) => s.exerciseId === e.id && s.weightKg > 0).sort((a, b) => b.date.localeCompare(a.date))[0]
        return finding('goal_path', e.id, { ...base, path: last ? 'not_trained' : 'find_weight', weightKg: last?.weightKg ?? null, low: last?.reps ?? null, research: 'progress' })
    }

    // A goal lift that stopped improving: take some weight off and build back up, which a new range
    // and a run of easier sessions restart (the stall ladder after the notes and recovery)
    const stalled = lift.flatWindows >= STALL_WINDOWS && rx.how === 'load'
    const dropKg = stalled ? kgOf(roundToStep(display(rx.weightKg * (1 - STALL_DROP), ctx.unit), stepOf(e, ctx.unit)), ctx.unit) : null
    const e1 = e1rmNow(e, ctx)
    const weighted = rx.how === 'load' || rx.how === 'load_now'
    // Heavier sets suit a strength goal; a second day suits a lift trained once. Neither for a joint Ronnie knows is injured.
    const heavy = strength && weighted && !injury && e1 != null && rx.low >= 6
    const secondDay = daysTrained(e, ctx) <= 1 && weighted && !injury && e1 != null && !ctx.shrink
    return finding('goal_path', e.id, {
        ...base, path: stalled ? 'stalled' : rx.how, ...rxData(rx), dropKg, flatWindows: lift.flatWindows,
        options: [heavy && 'heavy', secondDay && 'second_day'].filter(Boolean).join(','),
        heavyKg: heavy ? shareOf(e1!, HEAVY_SHARE, e, ctx.unit) : null,
        secondKg: secondDay ? shareOf(e1!, SECOND_DAY_SHARE, e, ctx.unit) : null,
        daysTrained: daysTrained(e, ctx),
        research: ['progress', heavy && 'heavy', secondDay && 'frequency'].filter(Boolean).join(','),
    })
}

/**
 * A lift's numbers for a lighter week, from its next session: the weight about 10% down, on the
 * nearest step and at least one step lighter (a weight already at one step stays), half the sets
 * at the same reps; an assisted or bodyweight lift keeps its assist or reps with half the sets
 */
export function deloadOf(rx: Prescription, e: ExerciseInfo, unit: 'kg' | 'lb'): Finding['data'] {
    const sets = Math.max(1, Math.ceil(rx.sets / 2))
    const base = { how: 'deload', low: rx.low, sets, usualSets: rx.sets, assistKg: rx.assistKg, weightKg: rx.weightKg, usualKg: rx.weightKg }
    if (rx.how !== 'load' && rx.how !== 'load_now') return { ...base, ...(rx.how === 'assist' ? { assisted: 1 } : { bodyweight: 1 }) }
    const step = stepOf(e, unit)
    const shown = display(rx.weightKg, unit)
    const near = Math.round((shown * (1 - DELOAD_DROP)) / step) * step
    const lighter = Math.max(step, near < shown ? near : shown - step)
    return { ...base, weightKg: lighter < shown ? kgOf(lighter, unit) : rx.weightKg }
}

/** Days this period the exercise was trained */
function daysTrained(e: ExerciseInfo, ctx: Context): number {
    return new Set(ctx.inputs.sets.filter((s) => s.exerciseId === e.id && ctx.windowOf(s.date) === 0).map((s) => s.date)).size
}

/**
 * The next-session findings, added to the rules' (plan.ts). A goal lift's stall is part of its
 * plan, so its lift_stalled finding gives way; a regressed lift keeps its own finding, which says to
 * hold, and gets no plan.
 */
export function withPlan(fired: Finding[], facts: ReportFacts, inputs: ReportInputs): Finding[] {
    const unit = inputs.weightUnit ?? 'kg'
    const memory = inputs.memory ?? []
    const ctx: Context = {
        inputs, facts, unit,
        windowOf: windowOfFor(inputs.periodStart, inputs.periodEnd),
        library: inputs.library ?? inputs.exercises,
        disliked: new Set(memory.filter((n) => n.kind === 'exercise' && n.state === 'dislike' && n.subject).map((n) => n.subject!)),
        injuries: new Map(memory.filter((n) => n.kind === 'injury' && n.state === 'active' && n.subject).map((n) => [n.subject!, { text: n.text, date: n.date }])),
        pains: (inputs.weekRead?.signals ?? []).filter((s) => s.kind === 'pain'),
        shrink: fired.some((f) => f.rule === 'missed_sessions' && f.data.shrink),
    }
    const regressed = new Set(fired.filter((f) => f.rule === 'lift_regressed').map((f) => f.subject))
    const targets = (inputs.goalRead?.targets ?? []).filter((t) => t.kind === 'lift' && t.exerciseId)
    const goalIds = new Set(targets.map((t) => t.exerciseId!))
    const exerciseOf = (id: string) => inputs.exercises.find((x) => x.id === id)
    const added: Finding[] = []
    const held = new Set<string>()

    // A lift that hurt this period, goal or not
    for (const l of facts.lifts) {
        const e = exerciseOf(l.exerciseId)
        const pain = e && !regressed.has(e.id) ? painFor(e, ctx.pains) : null
        const f = pain && e ? painHold(e, pain, ctx) : null
        if (f) {
            added.push(f)
            held.add(l.exerciseId)
        }
    }
    // A lighter week: every main lift's numbers for it (but a held one's), and no plan to add weight
    if (fired.some((f) => f.rule === 'deload')) {
        for (const l of facts.lifts) {
            const e = held.has(l.exerciseId) ? undefined : exerciseOf(l.exerciseId)
            const rx = e ? prescribe(e, inputs.sets, unit, ctx.windowOf) : null
            if (e && rx) added.push(finding('next_session', e.id, { ...nameData(e), ...deloadOf(rx, e, unit) }))
        }
        return [...fired, ...added].sort((a, b) => b.priority - a.priority)
    }
    for (const t of targets) {
        if (regressed.has(t.exerciseId!) || held.has(t.exerciseId!)) continue
        const f = goalPath(t, (facts.goal.progress ?? []).find((p) => p.target.exerciseId === t.exerciseId), ctx)
        if (f) added.push(f)
    }
    // The other main lifts, the ones no rule already speaks to, nor a goal's plan goes through (the pulldown toward a pull-up)
    const spoken = new Set([
        ...fired.filter((f) => f.rule === 'lift_stalled' || f.rule === 'lift_regressed').map((f) => f.subject),
        ...added.map((f) => f.data.viaId).filter((id): id is string => typeof id === 'string'),
    ])
    const others = facts.lifts.filter((l: LiftFacts) => !goalIds.has(l.exerciseId) && !spoken.has(l.exerciseId) && !held.has(l.exerciseId))
    for (const l of others.slice(0, MAX_NEXT_LINES)) {
        const e = exerciseOf(l.exerciseId)
        const rx = e ? prescribe(e, inputs.sets, unit, ctx.windowOf) : null
        if (e && rx) added.push(finding('next_session', e.id, { ...nameData(e), ...rxData(rx) }))
    }
    // A goal lift's stall is in its plan; a lift held for pain isn't pushed by the stall rule either
    const kept = fired.filter((f) => !(f.rule === 'lift_stalled' && (goalIds.has(String(f.subject)) || held.has(String(f.subject)))))
    return [...kept, ...added].sort((a, b) => b.priority - a.priority)
}
