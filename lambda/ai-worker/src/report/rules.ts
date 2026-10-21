import { VOLUME_RANGE } from './facts'
import { hasTarget } from '../../../../lib/report/volume'
import type { BestSet, Finding, FollowUp, FollowUpStatus, LiftFacts, ReportFacts, RuleId, Watching } from './types'

// The rule table. A rule fires on the facts alone; the report may only advise on a
// rule that fired, and each one names the data that fired it. The research behind
// each rule goes with its text in the app (messages: report.rules).
//
// Thresholds are deliberately conservative, so a report flags a pattern rather than
// one bad day. Below a threshold the item is "watching": shown in the full
// analysis, never as advice.

/** Two or more main lifts down at least this much in one period: a deload */
const DELOAD_DROP_PCT = -3
/** One lift down at least this much, or down two periods in a row */
const REGRESSED_DROP_PCT = -5
/** Periods without beating the lift's best before a stall is called */
const STALL_WINDOWS = 3
/** Body weight moving against the goal this many periods in a row */
const WEIGHT_WINDOWS = 4
/** Cardio minutes before the first leg set that make it more than a warm-up (5-10 minutes is one) */
export const CARDIO_BEFORE_LEGS_MIN = 15
/** Sets a low muscle's advice adds at most each week: a step toward 10, not the whole gap at once (research brief, 2026-10-20) */
export const MAX_ADD_SETS = 2

// Safety first, then the lifts (the goal's before the others), then the plan, then volume (owner, 2026-10-20)
const PRIORITY: Record<RuleId, number> = {
    deload: 100,
    pain_hold: 90,
    lift_regressed: 70,
    goal_path: 65,
    lift_stalled: 60,
    next_session: 55,
    missed_sessions: 52,
    low_volume: 50,
    weight_trend: 30,
    // Last: the order changes lower-body strength a little, and muscle growth not at all
    cardio_first: 25,
}
/** A lift the goal names comes before the others */
const GOAL_BONUS = 20

/** A set as finding data: "82.5x8" (kg x reps). For an assisted lift (assisted: 1) the number is the assist, for an added-weight one (added: 1) the weight on top of the body, as the bodyweight flag says to read only the reps. */
const setText = (s: BestSet | null) => (s ? `${s.assistKg ?? s.weightKg}x${s.reps}` : null)
const liftData = (l: LiftFacts) => ({
    name: l.name,
    nameZh: l.nameZh,
    best: setText(l.best),
    previousBest: setText(l.previousBest),
    change: l.change,
    bodyweight: l.bodyweight ? 1 : 0,
    // Only when it is one, so other lifts' data stays as it was
    ...(l.assisted ? { assisted: 1 } : {}),
    ...(l.added ? { added: 1 } : {}),
})
/** Compared by reps, assist or added weight, which move in whole steps: no percentage applies */
const byPercent = (l: LiftFacts) => !l.bodyweight && !l.assisted && !l.added

/**
 * Whether a low muscle's sets are advice. Without a goal they aren't: the user only logs, and the
 * muscles row still shows them (owner, 2026-10-20). For a strength goal only a muscle a stalled
 * goal lift mainly trains, since its sets are what may move that lift. Any other goal, or one not
 * read, keeps the advice. primaryUnitsOf gives the units an exercise mainly trains.
 */
function volumeAdvised(facts: ReportFacts, primaryUnitsOf?: (exerciseId: string) => string[]): (group: string) => boolean {
    if (!facts.goal.text?.trim()) return () => false
    const kinds = facts.goal.read?.model ? facts.goal.read.kinds : []
    const strengthOnly = kinds.includes('strength') && !kinds.includes('muscle') && !kinds.includes('physique')
    if (!strengthOnly) return () => true
    const stalled = new Set(facts.lifts.filter((l) => l.goalLift && l.flatWindows >= STALL_WINDOWS).flatMap((l) => primaryUnitsOf?.(l.exerciseId) ?? []))
    return (group) => stalled.has(group)
}

export function evaluateRules(facts: ReportFacts, primaryUnitsOf?: (exerciseId: string) => string[]): { findings: Finding[]; watching: Watching[] } {
    const findings: Finding[] = []
    const watching: Watching[] = []
    const add = (rule: RuleId, subject: string | null, data: Finding['data'], bonus = 0) =>
        findings.push({ id: `${rule}:${subject ?? '-'}`, rule, subject, priority: PRIORITY[rule] + bonus, data })

    // Deload: several main lifts dropped at once and more went down than up, which points at
    // fatigue rather than one lift
    const dropped = facts.lifts.filter((l) => byPercent(l) && l.trend === 'down' && (l.change ?? 0) <= DELOAD_DROP_PCT)
    const deload = dropped.length >= 2 && facts.liftsSummary.down > facts.liftsSummary.up
    if (deload) {
        add('deload', null, {
            lifts: dropped.map((l) => l.name).join(', '),
            liftsZh: dropped.map((l) => l.nameZh ?? l.name).join('、'),
            count: dropped.length,
            totalSets: facts.totalSets.now,
        })
    }

    for (const l of facts.lifts) {
        const bonus = l.goalLift ? GOAL_BONUS : 0
        const sharpDrop = byPercent(l) && (l.change ?? 0) <= REGRESSED_DROP_PCT
        if (l.trend === 'down' && !deload && (sharpDrop || l.downWindows >= 2)) {
            // The level before the drop began, which a follow-up checks the lift got back to
            const before = l.series.filter((v) => v != null).at(-(l.downWindows + 1)) ?? null
            add('lift_regressed', l.exerciseId, { ...liftData(l), downWindows: l.downWindows, previousValue: before }, bonus)
        } else if (l.trend !== 'down' && l.flatWindows >= STALL_WINDOWS) {
            add('lift_stalled', l.exerciseId, { ...liftData(l), flatWindows: l.flatWindows }, bonus)
        } else if (l.trend !== 'down' && l.flatWindows === STALL_WINDOWS - 1) {
            watching.push({ rule: 'lift_stalled', subject: l.exerciseId, data: { ...liftData(l), flatWindows: l.flatWindows } })
        }
    }

    const { done, planned, days } = facts.sessions
    const missedSessions = planned != null && done < planned

    // Low volume only for a muscle the user actually trains (this period, the one before, or in
    // a planned session). One cause, one finding: a muscle the missed sessions would have brought
    // into range, by their routines' target sets, is part of the missed-sessions finding, not a
    // volume problem. Measured against the plan, so it holds in a first report too.
    const lowFromMissing: string[] = []
    const advised = volumeAdvised(facts, primaryUnitsOf)
    for (const m of facts.muscles) {
        const trainsIt = m.sets > 0 || (m.previousPerWeek ?? 0) > 0 || (m.missedPerWeek ?? 0) > 0
        if (m.status !== 'low' || !trainsIt || !hasTarget(m.group)) continue
        if (missedSessions && m.perWeek + (m.missedPerWeek ?? 0) >= VOLUME_RANGE.low) lowFromMissing.push(m.group)
        else if (advised(m.group)) {
            // Sets to add each period toward the weekly minimum, so the advice has an exact number: at most MAX_ADD_SETS a week
            const addSets = Math.min(Math.ceil((MAX_ADD_SETS * facts.period.days) / 7), Math.ceil((VOLUME_RANGE.low * facts.period.days) / 7 - m.sets))
            add('low_volume', m.group, { sets: m.sets, perWeek: m.perWeek, previousPerWeek: m.previousPerWeek, target: VOLUME_RANGE.low, addSets })
        }
    }

    if (missedSessions) {
        const missed = days.filter((d) => d.routine && !d.trained)
        add('missed_sessions', null, {
            done,
            planned,
            missed: missed.length,
            routines: missed.map((d) => d.routine).join(', '),
            dates: missed.map((d) => d.date).join(', '),
            lowGroups: lowFromMissing.join(', ') || null,
        })
    }

    // Body weight against the goal: gaining while cutting, or losing while bulking
    const { direction } = facts.goal
    const w = facts.bodyWeight
    const against = direction === 'gain' ? -w.trendWindows : direction === 'lose' ? w.trendWindows : 0
    if (against >= WEIGHT_WINDOWS && w.weighIns > 0) {
        add('weight_trend', null, { direction, periods: against, latestKg: w.latestKg, changeKg: w.changeKg })
    } else if (against >= 2) {
        watching.push({ rule: 'weight_trend', subject: null, data: { direction, periods: against, latestKg: w.latestKg, weighIns: w.weighIns, needed: WEIGHT_WINDOWS } })
    }

    // Cardio before the leg lifts in the same session: lifting first gave more lower-body strength.
    // One finding for the period, with the session that had the most cardio first.
    const cardioFirst = (facts.cardio?.legSessions ?? []).filter((x) => x.minutesBefore >= CARDIO_BEFORE_LEGS_MIN)
    if (cardioFirst.length) {
        const most = [...cardioFirst].sort((a, b) => b.minutesBefore - a.minutesBefore || a.date.localeCompare(b.date))[0]
        add('cardio_first', null, {
            sessions: cardioFirst.length,
            dates: cardioFirst.map((x) => x.date).join(', '),
            date: most.date,
            routine: most.routine,
            minutes: most.minutesBefore,
            cardio: most.cardio?.name ?? null,
            cardioZh: most.cardio ? most.cardio.nameZh ?? most.cardio.name : null,
            lift: most.lift.name,
            liftZh: most.lift.nameZh ?? most.lift.name,
        })
    }

    findings.sort((a, b) => b.priority - a.priority)
    return { findings, watching }
}

/**
 * How the previous report's findings turned out. liftOf gives any exercise trained
 * this period, since a lift that was flagged may no longer be a main lift.
 */
export function followUp(previous: Finding[] | null, facts: ReportFacts, liftOf: (exerciseId: string) => LiftFacts | null): FollowUp[] {
    if (!previous?.length) return []
    // A volume finding from before the muscles were split (legs, shoulders) has nothing to compare
    // with now; holding a lift for pain has nothing to check
    return previous.filter((f) => (f.rule !== 'low_volume' || hasTarget(String(f.subject))) && f.rule !== 'pain_hold').map((f): FollowUp => {
        const result = (status: FollowUpStatus, data: FollowUp['data'] = {}): FollowUp => ({
            id: f.id, rule: f.rule, subject: f.subject, status, data: { ...f.data, ...data },
        })
        switch (f.rule) {
            case 'lift_stalled':
            case 'lift_regressed': {
                const l = f.subject ? liftOf(f.subject) : null
                if (!l || !l.best) return result('not_done', { trained: 0 })
                const now = setText(l.best)
                if (f.rule === 'lift_stalled') return result(l.trend === 'up' ? 'done' : 'not_done', { now })
                const back = typeof f.data.previousValue === 'number' && l.series.at(-1)! >= f.data.previousValue
                return result(back ? 'done' : l.trend === 'up' ? 'partial' : 'not_done', { now })
            }
            case 'low_volume': {
                const m = facts.muscles.find((x) => x.group === f.subject)
                const week = m?.perWeek ?? 0
                const before = typeof f.data.perWeek === 'number' ? f.data.perWeek : 0
                return result(week >= VOLUME_RANGE.low ? 'done' : week > before ? 'partial' : 'not_done', { nowPerWeek: week })
            }
            case 'missed_sessions': {
                const { done, planned } = facts.sessions
                // No cycle any more: nothing planned to count against
                if (planned == null) return result('not_done', { nowDone: done, noPlan: 1 })
                const missedNow = planned - done
                const missedBefore = typeof f.data.missed === 'number' ? f.data.missed : missedNow
                return result(missedNow <= 0 ? 'done' : missedNow < missedBefore ? 'partial' : 'not_done', { nowDone: done, nowPlanned: planned })
            }
            case 'deload': {
                const before = typeof f.data.totalSets === 'number' ? f.data.totalSets : 0
                return result(before > 0 && facts.totalSets.now <= before * 0.7 ? 'done' : 'not_done', { nowSets: facts.totalSets.now })
            }
            case 'weight_trend': {
                // No weigh-in this period: the trend can't say, and 0 would read as done
                if (!facts.bodyWeight.weighIns) return result('not_done', { weighIns: 0 })
                const t = facts.bodyWeight.trendWindows
                const stillAgainst = f.data.direction === 'gain' ? t < 0 : t > 0
                return result(stillAgainst ? 'not_done' : 'done', { nowKg: facts.bodyWeight.latestKg })
            }
            case 'goal_path':
            case 'next_session':
            case 'pain_hold': {
                // The lift the plan went through (a pulldown toward a first pull-up), against the plan's numbers
                const id = typeof f.data.viaId === 'string' ? f.data.viaId : f.subject
                const l = id ? liftOf(id) : null
                if (!l || !l.best) return result('not_done', { trained: 0 })
                const now = setText(l.best)
                return result(planStatus(f.data, l.best), { now })
            }
            case 'cardio_first': {
                // Done when every lower-body session put the legs first; nothing to judge without one
                const legs = facts.cardio?.legSessions ?? []
                const still = legs.filter((x) => x.minutesBefore >= CARDIO_BEFORE_LEGS_MIN).length
                if (!legs.length) return result('not_done', { legSessions: 0 })
                return result(!still ? 'done' : still < legs.length ? 'partial' : 'not_done', { legSessions: legs.length, stillFirst: still })
            }
        }
    })
}

/**
 * A plan followed up against this period's best set: done when it reached the plan's next step
 * (the next weight, the top reps, less assist), partial when it moved toward it.
 */
function planStatus(d: Finding['data'], best: BestSet): FollowUpStatus {
    const low = Number(d.low)
    switch (d.how) {
        case 'assist': return best.assistKg != null && best.assistKg < Number(d.assistKg) ? 'done' : best.reps > low ? 'partial' : 'not_done'
        case 'reps': return best.reps >= Number(d.top) ? 'done' : best.reps > low ? 'partial' : 'not_done'
        case 'load':
        case 'load_now':
            return d.nextKg != null && best.weightKg >= Number(d.nextKg) ? 'done'
                : best.weightKg > Number(d.weightKg) || (best.weightKg === Number(d.weightKg) && best.reps > low) ? 'partial' : 'not_done'
        // Not trained then, or where to start: trained now is done
        default: return 'done'
    }
}
