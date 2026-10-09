import { VOLUME_GROUPS, VOLUME_RANGE } from './facts'
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

const PRIORITY: Record<RuleId, number> = {
    deload: 100,
    lift_regressed: 70,
    lift_stalled: 60,
    low_volume: 50,
    missed_sessions: 40,
    weight_trend: 30,
}
/** A lift the goal names comes before the others */
const GOAL_BONUS = 20

const setText = (s: BestSet | null) => (s ? `${s.weightKg}x${s.reps}` : null)
const liftData = (l: LiftFacts) => ({
    name: l.name,
    nameZh: l.nameZh,
    best: setText(l.best),
    previousBest: setText(l.previousBest),
    change: l.change,
    bodyweight: l.bodyweight ? 1 : 0,
})

export function evaluateRules(facts: ReportFacts): { findings: Finding[]; watching: Watching[] } {
    const findings: Finding[] = []
    const watching: Watching[] = []
    const add = (rule: RuleId, subject: string | null, data: Finding['data'], bonus = 0) =>
        findings.push({ id: `${rule}:${subject ?? '-'}`, rule, subject, priority: PRIORITY[rule] + bonus, data })

    // Deload: several main lifts dropped at once and more went down than up, which points at
    // fatigue rather than one lift
    const dropped = facts.lifts.filter((l) => !l.bodyweight && l.trend === 'down' && (l.change ?? 0) <= DELOAD_DROP_PCT)
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
        const sharpDrop = !l.bodyweight && (l.change ?? 0) <= REGRESSED_DROP_PCT
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

    // Low volume only for a group the user actually trains (this period or the one before).
    // One cause, one finding: a group that was in range last period and is low only because a
    // session was missed is part of the missed-sessions finding, not a volume problem.
    const lowFromMissing: string[] = []
    for (const m of facts.muscles) {
        const trainsIt = m.sets > 0 || (m.previousPerWeek ?? 0) > 0
        if (m.status !== 'low' || !trainsIt || !VOLUME_GROUPS.includes(m.group)) continue
        if (missedSessions && (m.previousPerWeek ?? 0) >= VOLUME_RANGE.low) lowFromMissing.push(m.group)
        else add('low_volume', m.group, { sets: m.sets, perWeek: m.perWeek, previousPerWeek: m.previousPerWeek, target: VOLUME_RANGE.low })
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

    findings.sort((a, b) => b.priority - a.priority)
    return { findings, watching }
}

/**
 * How the previous report's findings turned out. liftOf gives any exercise trained
 * this period, since a lift that was flagged may no longer be a main lift.
 */
export function followUp(previous: Finding[] | null, facts: ReportFacts, liftOf: (exerciseId: string) => LiftFacts | null): FollowUp[] {
    if (!previous?.length) return []
    return previous.map((f) => {
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
                if (planned == null) return result('not_done', { nowDone: done })
                const missedNow = planned - done
                const missedBefore = typeof f.data.missed === 'number' ? f.data.missed : missedNow
                return result(missedNow <= 0 ? 'done' : missedNow < missedBefore ? 'partial' : 'not_done', { nowDone: done, nowPlanned: planned })
            }
            case 'deload': {
                const before = typeof f.data.totalSets === 'number' ? f.data.totalSets : 0
                return result(before > 0 && facts.totalSets.now <= before * 0.7 ? 'done' : 'not_done', { nowSets: facts.totalSets.now })
            }
            case 'weight_trend': {
                const t = facts.bodyWeight.trendWindows
                const stillAgainst = f.data.direction === 'gain' ? t < 0 : t > 0
                return result(stillAgainst ? 'not_done' : 'done', { nowKg: facts.bodyWeight.latestKg })
            }
        }
    })
}
