// The weekly report (version 3), shared by the report Lambda and the app that shows it.
// In lambda/ai-worker/src/report, code computes every number and decides which rules
// fire (facts.ts, rules.ts); the model only picks among the fired rules and writes
// them in plain language (narrative.ts). The saved report is ReportV3.

import type { LogType } from '../exercise-attributes'
import type { MemoryKind } from '../ronnie/memory'

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
    /** Joint -> low/medium/high (lib/exercise-attributes.ts); null for a custom exercise; absent in evals that don't give it */
    jointLoad?: Record<string, string> | null
    /** barbell, dumbbell, machine, cable...: what sets the size of a weight step (plan.ts) */
    equipment?: string | null
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
    /** Treadmill incline (%); absent in evals that don't set it */
    inclinePct?: number | null
    /** Bike, elliptical and stair machine level; absent in evals that don't set it */
    level?: number | null
    /** A cardio set's average heart rate (bpm), when the user typed one */
    avgHr?: number | null
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
    /** The goal as read (goal.ts), or null without a goal; absent where the goal isn't read (older evals) */
    goalRead?: GoalRead | null
    /** The goal's body-fat target needs weigh-ins with a body fat */
    bodyFat?: { date: string; pct: number }[]
    /** Ronnie's notes, and what the user said this period as read (week.ts); absent where they aren't read (evals) */
    memory?: ContextNote[]
    weekRead?: WeekRead
    /** The unit the user logs in, which sets the weight steps the advice names (plan.ts); kg when absent */
    weightUnit?: 'kg' | 'lb'
    /** The built-in exercises, for an alternative the plan may suggest; the exercises above when absent */
    library?: ExerciseInfo[]
    /** The user's age at the period's end, from the profile's birth date, for rating cardio by heart rate; null without one */
    age?: number | null
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
    /** A bodyweight exercise with added weight on some sets, compared by the added weight, then by reps; present only when true */
    added?: boolean
    /** One value per window, oldest first (estimated 1RM, or reps; for an assisted or added-weight lift a number that orders by the weight, then reps); null when not trained */
    series: (number | null)[]
    trend: Trend
    /** Percent change of the estimated 1RM (weighted) or change in reps (bodyweight) against the last trained window; null for an assisted or added-weight lift, whose sets say it */
    change: number | null
    /** Trained windows in a row, ending with this one, that didn't beat the best the run started from */
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
    added?: boolean
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

/**
 * This period's cardio minutes by intensity, rated from each set's average heart rate against the
 * user's estimated maximum (lib/report/cardio-intensity.ts). Sets without a heart rate, or every
 * set when the age is unknown, are unrated: counted in the minutes, never guessed.
 */
export interface CardioIntensityFacts {
    light: number
    moderate: number
    vigorous: number
    unrated: number
    /** The estimated maximum heart rate used; null without an age */
    maxHr: number | null
    /** Moderate plus twice the vigorous minutes, scaled to 7 days, as WHO counts them; null when none were rated */
    equivalentPerWeek: number | null
    /** Some sets have a heart rate, but there is no birth date to rate them with */
    needsAge: boolean
}

/**
 * One machine setting done in two or more periods with a heart rate: the first and the latest of
 * them, the latest this period. At the same speed and incline, or the same level, a lower heart
 * rate means the work got easier for the heart (Buchheit 2014).
 */
export interface CardioTrendFacts {
    exerciseId: string
    name: string
    nameZh: string | null
    logType: LogType
    /** Treadmill: km/h and incline %; machines with levels: the level */
    speedKmh: number | null
    inclinePct: number | null
    level: number | null
    first: { date: string; avgHr: number }
    last: { date: string; avgHr: number }
    /** Days with this setting and a heart rate, in the lookback */
    sessions: number
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
    /** Absent in reports saved before heart rate was logged */
    intensity?: CardioIntensityFacts
    trends?: CardioTrendFacts[]
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
        /** How many windows back that one is (1 for the last period); absent in reports saved before it was kept */
        changeWindows?: number | null
        weighIns: number
        /** One average per window, oldest first */
        series: (number | null)[]
        /** Windows in a row the average moved the same way: +n rising, -n falling */
        trendWindows: number
    }
    status: ReportStatus
    liftsSummary: { up: number; flat: number; down: number }
    goal: {
        text: string | null
        direction: 'gain' | 'lose' | null
        /** The goal as read (goal.ts); absent in reports saved before goals were read, null without a goal */
        read?: GoalRead | null
        /** How far each target is, from the logged sets and weigh-ins */
        progress?: GoalProgress[]
    }
    /** Absent in reports saved before cardio was read */
    cardio?: CardioFacts
    /**
     * Besides the log and the goal: Ronnie's notes and what the user said this period. Listed in
     * the full report so the user sees what it went on. Absent in reports saved before these were read.
     */
    context?: { memory: ContextNote[]; week: WeekRead }
}

// ---------- The goal ----------

/** What a goal is about; one goal can be several ("bench 70 kg and lose some fat") */
export type GoalKind = 'strength' | 'muscle' | 'fat_loss' | 'physique' | 'health' | 'endurance'

/** One thing the goal names, in the units the report computes in (kg) */
export interface GoalTarget {
    kind: 'lift' | 'body_weight' | 'body_fat' | 'focus'
    /** The goal's own words for it, as written */
    text: string
    /** lift: the exercise, from the user's or the library's */
    exerciseId?: string
    name?: string
    nameZh?: string | null
    /** lift: the load to reach, an estimated one-rep max; absent for a reps goal */
    loadKg?: number
    /** lift: the reps to reach; without a load, at body weight (a first pull-up is 1) */
    reps?: number
    /** body_weight */
    weightKg?: number
    /** body_fat: percent */
    bodyFatPct?: number
    /** lift, body_weight: the unit the goal wrote its number in (or the user's), which the report shows it in */
    unit?: 'kg' | 'lb'
    /** focus: the volume units a physique goal names (wider shoulders: side delts) */
    units?: string[]
}

export interface GoalRead {
    /** The text read: the next report reuses this read while the text is the same */
    text: string
    kinds: GoalKind[]
    targets: GoalTarget[]
    /** The part no target came from, as written; null when every part was read */
    unread: string | null
    /** The model that read it; null when it couldn't be read, and the next report tries again */
    model: string | null
}

export interface GoalProgress {
    target: GoalTarget
    /** lift with a load: the estimated one-rep max now, from sets of 10 reps or fewer */
    e1rmKg?: number | null
    /** e1rmKg against loadKg; weightKg's progress has no share (it can go either way) */
    share?: number | null
    /** One value per window, oldest first: the estimated 1RM (lift) or the average weigh-in (body_weight) */
    series?: (number | null)[]
    /** Change from the first window with a value to now, once at least 3 windows have one; null before */
    change?: number | null
    /** Windows the change spans */
    changeWindows?: number | null
    /** lift: days it was trained this period */
    days?: number
    /** lift with reps: the most reps in a set this period, at body weight */
    bestReps?: number | null
    /** A first pull-up the user can't do yet: the pulldown they train, against body weight */
    proxy?: {
        exerciseId: string; name: string; nameZh: string | null; e1rmKg: number; bodyWeightShare: number | null
        /** The pulldown 1RM a first pull-up likely comes with (PULL_UP_PULLDOWN_SHARE of body weight); null without a weigh-in */
        checkpointKg: number | null
    } | null
    /** The assisted version they train: the least assist, and how much of their weight they lift with it */
    assisted?: { exerciseId: string; name: string; nameZh: string | null; assistKg: number; reps: number; bodyWeightShare: number | null } | null
    /** body_weight, body_fat: the latest weigh-in */
    latestKg?: number | null
    latestPct?: number | null
    /** body_weight: percent of body weight per week across the series, once 3 windows have weigh-ins */
    ratePerWeek?: number | null
    /** focus: weekly sets of each unit */
    muscles?: { group: string; perWeek: number }[]
}

// ---------- What else the report read ----------

/** What the user said during the period that bears on training (week.ts) */
export const WEEK_SIGNAL_KINDS = ['pain', 'sore', 'tired', 'sick', 'away'] as const
export type WeekSignalKind = (typeof WEEK_SIGNAL_KINDS)[number]

export interface WeekSignal {
    /** The day it was written, a local date in the period */
    date: string
    /** A day note, or a message the user typed to Ronnie */
    source: 'note' | 'ronnie'
    kind: WeekSignalKind
    /** pain: where, one of JOINTS (lib/exercise-attributes.ts), when the words say */
    joint?: string
    /** The exercise it was about, one the user logs, when the words say */
    exerciseId?: string
    name?: string
    nameZh?: string | null
    /** The user's own words, found in that day's text */
    text: string
}

export interface WeekRead {
    signals: WeekSignal[]
    /** The user's texts read: day notes and messages to Ronnie */
    texts: number
    /** The model that read them; null when there was nothing to read or the read failed */
    model: string | null
    failed?: boolean
}

/** One of Ronnie's notes (lib/ronnie/memory.ts) as it stood when the report was made */
export interface ContextNote {
    kind: MemoryKind
    subject: string | null
    state: string
    text: string
    /** The local date it was last set */
    date: string
}

export type RuleId = 'deload' | 'lift_regressed' | 'lift_stalled' | 'low_volume' | 'missed_sessions' | 'weight_trend' | 'cardio_first'
    // Written by code, action and lines (plan.ts): next session for a goal's lift, for the other main lifts, and holding a lift that hurt;
    // and (rules.ts) training on fewer days than health guidelines suggest
    | 'goal_path' | 'next_session' | 'pain_hold' | 'few_days'

/** The rules whose action and lines code writes in full (lambda/ai-worker/src/report/plan.ts, rules.ts few_days): the model writes none of them */
export const CODE_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['goal_path', 'next_session', 'pain_hold', 'few_days'])

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
/**
 * One finding's part of an action, written by code and shown under it: a low muscle and the ways
 * to add its sets. Reports saved before 2026-10-19 have none; their actions name every item.
 */
export interface NarrativeLine {
    label: string
    text: string
}
export type NarrativeItem = { action: string; lines?: NarrativeLine[] } & ({ rule: RuleId; findingId?: undefined } | { findingId: string; rule?: undefined })

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
