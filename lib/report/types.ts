// The weekly report (version 3), shared by the report Lambda and the app that shows it.
// In lambda/ai-worker/src/report, code computes every number and decides which rules
// fire (facts.ts, rules.ts); the model only picks among the fired rules and writes
// them in plain language (narrative.ts). The saved report is ReportV3.

import type { LogType } from '../exercise-attributes'

export interface ExerciseInfo {
    id: string
    name: string
    nameZh: string | null
    muscleGroup: string
    /** From the exercise library; empty for a custom exercise (see lib/report/volume.ts) */
    primaryMuscles: string[]
    secondaryMuscles: string[]
    /** How its sets are logged (lib/set-log.ts): a cardio set keeps its time outside reps and weight */
    logType: LogType
}

/**
 * One logged set. Dates are YYYY-MM-DD in the user's own time zone. Every log type uses the
 * same row: a cardio or timed set has 0 reps and 0 kg, its values in the fields below, and a
 * set logged before its exercise had a log type has only reps and weight.
 */
export interface LoggedSet {
    date: string
    workoutId: string
    exerciseId: string
    reps: number
    weightKg: number
    /** Cardio and timed sets */
    durationS: number | null
    /** Treadmill sets */
    speedKmh: number | null
    /** Rower sets: the machine's metres */
    distanceM: number | null
    /** Assisted sets: the machine's help */
    assistKg: number | null
    /** When the set was logged (ISO), which orders the sets of one session */
    loggedAt: string
}

export interface ScheduledDay {
    date: string
    /** The routine planned that day, or null for a rest day */
    routine: string | null
    /** The routine's exercises and target sets, as the routine is now */
    plan: { exerciseId: string; sets: number }[]
}

export interface ReportInputs {
    periodStart: string
    periodEnd: string
    /** Every set of the lookback windows, plus all earlier sets of the exercises trained this period */
    sets: LoggedSet[]
    exercises: ExerciseInfo[]
    /** The training cycle's plan for each day of the period; null for users without a cycle */
    schedule: ScheduledDay[] | null
    weighIns: { date: string; weightKg: number }[]
    goal: string | null
    /** The first exercise of each of the user's routines: programs put the main lift first */
    routineLeads: string[]
    /** Findings of the previous report, to follow up; null when there is none */
    previousFindings: Finding[] | null
    /** The user's notes on single days of the period (at most one a day), oldest first */
    notes: { date: string; note: string }[]
}

export interface BestSet {
    weightKg: number
    reps: number
    /** Assisted lifts only: the machine's help, where less is stronger */
    assistKg?: number
}

export type Trend = 'up' | 'flat' | 'down' | 'new'

export interface LiftFacts {
    exerciseId: string
    name: string
    nameZh: string | null
    muscleGroup: string
    /** Sets this period */
    sets: number
    best: BestSet | null
    previousBest: BestSet | null
    /** Bodyweight lifts are compared by reps; weighted lifts by estimated 1RM */
    bodyweight: boolean
    /** Assisted lifts are compared by assist, less first, then by reps; absent in reports saved before assisted lifts were read */
    assisted?: boolean
    /** One value per window, oldest first (estimated 1RM, or reps; for an assisted lift a number that orders by assist, then reps); null when not trained */
    series: (number | null)[]
    trend: Trend
    /** Percent change of the estimated 1RM (weighted) or change in reps (bodyweight) against the last trained window; null for an assisted lift, whose sets say it */
    change: number | null
    /** Trained windows in a row, ending with this one, that didn't beat the best before them */
    flatWindows: number
    /** Trained windows in a row, ending with this one, each lower than the one before */
    downWindows: number
    goalLift: boolean
}

export interface MuscleFacts {
    /** A volume unit (lib/report/volume.ts); reports saved before the split hold category names */
    group: string
    /** Can be fractional: a secondary muscle counts half a set */
    sets: number
    /** Sets scaled to 7 days, so a 4-day cycle compares with the weekly range */
    perWeek: number
    previousPerWeek: number | null
    /** What the sessions missed this period would have added, scaled to 7 days; null without a cycle */
    missedPerWeek: number | null
    status: 'low' | 'ok' | 'high' | 'no_target'
}

export interface DayFacts {
    date: string
    routine: string | null
    trained: boolean
}

/** A day's note next to that day's plan and whether the user trained: code lines them up, the model reads them */
export interface DayNote extends DayFacts {
    note: string
}

export interface RecordFacts {
    exerciseId: string
    name: string
    nameZh: string | null
    best: BestSet
    bodyweight: boolean
    assisted?: boolean
    date: string
}

/** One cardio exercise this period */
export interface CardioExerciseFacts {
    exerciseId: string
    name: string
    nameZh: string | null
    logType: LogType
    minutes: number
    /** Treadmill: speed x time */
    km: number | null
    /** Rower: the machine's metres */
    metres: number | null
    /** Days it was done */
    days: number
}

/** A session this period with a lower-body lift, and the cardio logged in it before that lift */
export interface LegSessionFacts {
    date: string
    /** The routine the cycle planned that day, or null */
    routine: string | null
    /** Cardio minutes logged in the same session before its first lower-body set */
    minutesBefore: number
    /** The cardio done most before it; null when there was none */
    cardio: { name: string; nameZh: string | null } | null
    /** The session's first lower-body lift */
    lift: { name: string; nameZh: string | null }
}

/**
 * Cardio, reported as a fact: how much and what. The report gives no advice on how much cardio
 * to do; the one rule about it is its order on a lower-body day (cardio_first).
 */
export interface CardioFacts {
    /** Minutes this period, from every cardio set with its time */
    minutes: number
    /** Scaled to 7 days, like weekly sets */
    perWeek: number
    previousPerWeek: number | null
    /** Days with cardio */
    days: number
    exercises: CardioExerciseFacts[]
    legSessions: LegSessionFacts[]
}

export type ReportStatus = 'progressing' | 'stalling' | 'regressing' | 'baseline'

export interface ReportFacts {
    period: { start: string; end: string; days: number }
    sessions: { done: number; planned: number | null; days: DayFacts[] }
    /** Working sets: every set but cardio */
    totalSets: { now: number; previous: number | null }
    muscles: MuscleFacts[]
    /** The main lifts: goal lifts first, then the most-trained exercises. Strength lifts only, never cardio or timed work. */
    lifts: LiftFacts[]
    records: RecordFacts[]
    bodyWeight: {
        latestKg: number | null
        /** This window's average against the last window with weigh-ins */
        changeKg: number | null
        weighIns: number
        /** One average per window, oldest first */
        series: (number | null)[]
        /** Windows in a row the average moved the same way: +n rising, -n falling */
        trendWindows: number
    }
    status: ReportStatus
    liftsSummary: { up: number; flat: number; down: number }
    goal: { text: string | null; direction: 'gain' | 'lose' | null }
    /** Absent in reports saved before cardio was read */
    cardio?: CardioFacts
}

export type RuleId = 'deload' | 'lift_regressed' | 'lift_stalled' | 'low_volume' | 'missed_sessions' | 'weight_trend' | 'cardio_first'

type Data = Record<string, number | string | null>

export interface Finding {
    /** rule:subject, stable across reports so the next one can follow it up */
    id: string
    rule: RuleId
    /** The exercise id or muscle group it is about, or null */
    subject: string | null
    priority: number
    data: Data
}

/** Below a rule's threshold: shown in the full analysis, never as advice */
export interface Watching {
    rule: RuleId
    subject: string | null
    data: Data
}

export type FollowUpStatus = 'done' | 'partial' | 'not_done'

export interface FollowUp {
    id: string
    rule: RuleId
    subject: string | null
    status: FollowUpStatus
    data: Data
}

export interface ReportNarrative {
    headline: string
    /** One action per fired rule, covering every finding of it, in priority order. Reports saved
     *  before 2026-10-09 have one item per finding (findingId) instead. */
    items: NarrativeItem[]
}
export type NarrativeItem = { action: string } & ({ rule: RuleId; findingId?: undefined } | { findingId: string; rule?: undefined })

export interface ReportV3 {
    version: 3
    facts: ReportFacts
    findings: Finding[]
    watching: Watching[]
    followUps: FollowUp[]
    /** The day notes the text was written with; reports saved before 2026-10-10 have none */
    dayNotes?: DayNote[]
    narrative: ReportNarrative
}
