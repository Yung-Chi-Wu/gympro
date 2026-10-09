// The weekly report (version 3), shared by the report Lambda and the app that shows it.
// In lambda/ai-worker/src/report, code computes every number and decides which rules
// fire (facts.ts, rules.ts); the model only picks among the fired rules and writes
// them in plain language (narrative.ts). The saved report is ReportV3.

export interface ExerciseInfo {
    id: string
    name: string
    nameZh: string | null
    muscleGroup: string
}

/** One logged set. Dates are YYYY-MM-DD in the user's own time zone. */
export interface LoggedSet {
    date: string
    workoutId: string
    exerciseId: string
    reps: number
    weightKg: number
}

export interface ScheduledDay {
    date: string
    /** The routine planned that day, or null for a rest day */
    routine: string | null
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
}

export interface BestSet {
    weightKg: number
    reps: number
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
    /** One value per window, oldest first (estimated 1RM, or reps); null when not trained */
    series: (number | null)[]
    trend: Trend
    /** Percent change of the estimated 1RM (weighted) or change in reps (bodyweight) against the last trained window */
    change: number | null
    /** Trained windows in a row, ending with this one, that didn't beat the best before them */
    flatWindows: number
    /** Trained windows in a row, ending with this one, each lower than the one before */
    downWindows: number
    goalLift: boolean
}

export interface MuscleFacts {
    group: string
    sets: number
    /** Sets scaled to 7 days, so a 4-day cycle compares with the weekly range */
    perWeek: number
    previousPerWeek: number | null
    status: 'low' | 'ok' | 'high' | 'no_target'
}

export interface DayFacts {
    date: string
    routine: string | null
    trained: boolean
}

export interface RecordFacts {
    exerciseId: string
    name: string
    nameZh: string | null
    best: BestSet
    bodyweight: boolean
    date: string
}

export type ReportStatus = 'progressing' | 'stalling' | 'regressing' | 'baseline'

export interface ReportFacts {
    period: { start: string; end: string; days: number }
    sessions: { done: number; planned: number | null; days: DayFacts[] }
    totalSets: { now: number; previous: number | null }
    muscles: MuscleFacts[]
    /** The main lifts: goal lifts first, then the most-trained exercises */
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
}

export type RuleId = 'deload' | 'lift_regressed' | 'lift_stalled' | 'low_volume' | 'missed_sessions' | 'weight_trend'

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
    items: { findingId: string; action: string }[]
}

export interface ReportV3 {
    version: 3
    facts: ReportFacts
    findings: Finding[]
    watching: Watching[]
    followUps: FollowUp[]
    narrative: ReportNarrative
}
