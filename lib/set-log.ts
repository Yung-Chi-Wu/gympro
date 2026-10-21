import { CARDIO_LOG_TYPES, LOG_TYPE_IDS, type LogType } from './exercise-attributes'
import { toDisplayWeight, toStorageKg, type WeightUnit } from './weight-unit'
import { toDisplayDistance, toDisplaySpeed, toStorageKmh, type DistanceUnit } from './distance-unit'

// How a set is logged, shown and summed up, for each log type (exercises.log_type). Every type
// uses the same workout_sets row: the columns it doesn't use are null, and reps and weight_kg 0,
// so readers that only know reps x weight keep working. Values are stored metric; units only
// change what is shown and typed. A weighted set also keeps the unit it was typed in
// (input_unit), so it can be shown exactly as typed. Shared by the logging card and the history list.

export interface Units {
    weight: WeightUnit
    distance: DistanceUnit
}

/** A logged set, as stored */
export interface SetValues {
    reps: number
    weightKg: number
    durationS: number | null
    speedKmh: number | null
    inclinePct: number | null
    level: number | null
    distanceM: number | null
    assistKg: number | null
    /** The unit a weighted set was typed in; null for a set without weight, or logged before units were kept */
    inputUnit: WeightUnit | null
}

export type FieldKey = 'weight' | 'added' | 'assist' | 'reps' | 'seconds' | 'minutes' | 'speed' | 'incline' | 'level' | 'metres'

/** Each log type's columns, in order. Cardio is logged in sets too: each set is one setting of the machine. */
export const LOG_FIELDS: Record<LogType, FieldKey[]> = {
    weight_reps: ['weight', 'reps'],
    bodyweight: ['added', 'reps'],
    assisted: ['assist', 'reps'],
    duration: ['seconds'],
    // Speed, not distance: in a split run the machine's distance is a running total, the speed is what was set
    treadmill: ['minutes', 'speed', 'incline'],
    cardio_level: ['minutes', 'level'],
    rower: ['minutes', 'metres'],
    cardio_time: ['minutes'],
}

/** Fields typed in the exercise's own kg/lb (its logging unit) */
const WEIGHT_FIELDS = new Set<FieldKey>(['weight', 'added', 'assist'])
export const isWeightField = (key: FieldKey) => WEIGHT_FIELDS.has(key)
/** Whether the log type has a weight column, and so a kg/lb choice */
export const hasWeight = (logType: LogType) => LOG_FIELDS[logType].some(isWeightField)

/** A set with no reps or no time isn't a set. Every other field may be 0 (no incline, bodyweight alone). */
const MUST_BE_POSITIVE = new Set<FieldKey>(['reps', 'seconds', 'minutes'])
const WHOLE_NUMBER = new Set<FieldKey>(['reps', 'seconds'])
/**
 * The table's limits (workout_sets_amounts_valid and workout_sets_amounts_max), as stored (kg, km/h,
 * seconds, metres), so a typo is caught before it is saved, in whatever unit it was typed
 */
export const STORED_MAX = { reps: 1000, weightKg: 1000, assistKg: 500, durationS: 86_400, speedKmh: 50, inclinePct: 40, level: 100, distanceM: 100_000 } as const

export function logTypeOf(value: string | null | undefined): LogType {
    return LOG_TYPE_IDS.includes(value as LogType) ? (value as LogType) : 'weight_reps'
}

export const isCardio = (logType: LogType) => CARDIO_LOG_TYPES.includes(logType)

/**
 * What to log when it isn't obvious, shown beside the sets: an exercise done one side at a time
 * (exercises.per_side) is one side's numbers, both sides done counting as one set; one done with
 * dumbbells is the weight of one. The report counts sets and estimates a 1RM this way, so left and
 * right logged as two sets, or two dumbbells added up, would double them (owner, 2026-10-21).
 */
export type LogNote = 'per_side' | 'one_dumbbell'
export function logNoteOf(e: { per_side?: boolean | null; equipment?: string | null } | null | undefined): LogNote | null {
    if (e?.per_side) return 'per_side'
    return e?.equipment === 'dumbbell' ? 'one_dumbbell' : null
}

type SetRow = {
    reps: number
    weight_kg: number
    duration_s?: number | null
    speed_kmh?: number | string | null
    incline_pct?: number | string | null
    level?: number | string | null
    distance_m?: number | string | null
    assist_kg?: number | string | null
    input_unit?: string | null
}
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))

/** A workout_sets row as SetValues */
export function setValuesOf(row: SetRow): SetValues {
    return {
        reps: row.reps,
        weightKg: Number(row.weight_kg),
        durationS: num(row.duration_s),
        speedKmh: num(row.speed_kmh),
        inclinePct: num(row.incline_pct),
        level: num(row.level),
        distanceM: num(row.distance_m),
        assistKg: num(row.assist_kg),
        inputUnit: row.input_unit === 'kg' || row.input_unit === 'lb' ? row.input_unit : null,
    }
}

/** SetValues as workout_sets columns */
export function toSetRow(s: SetValues) {
    return {
        reps: s.reps,
        weight_kg: s.weightKg,
        duration_s: s.durationS,
        speed_kmh: s.speedKmh,
        incline_pct: s.inclinePct,
        level: s.level,
        distance_m: s.distanceM,
        assist_kg: s.assistKg,
        input_unit: s.inputUnit,
    }
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** One field of a set in the user's units, or null when the set has nothing there */
export function fieldValue(key: FieldKey, s: SetValues, units: Units): number | null {
    switch (key) {
        case 'weight':
        case 'added':
            return toDisplayWeight(s.weightKg, units.weight)
        case 'assist':
            return s.assistKg == null ? null : toDisplayWeight(s.assistKg, units.weight)
        case 'reps':
            return s.reps
        case 'seconds':
            return s.durationS
        case 'minutes':
            return s.durationS == null ? null : round(s.durationS / 60, 1)
        case 'speed':
            return s.speedKmh == null ? null : toDisplaySpeed(s.speedKmh, units.distance)
        case 'incline':
            return s.inclinePct
        case 'level':
            return s.level
        case 'metres':
            return s.distanceM
    }
}

/**
 * Whether the set has this log type's fields. Sets logged before log types existed have only
 * reps x weight; a cardio exercise's old sets are shown that way instead of in its columns.
 */
export function fitsLogType(logType: LogType, s: SetValues): boolean {
    return LOG_FIELDS[logType].every((key) => fieldValue(key, s, { weight: 'kg', distance: 'km' }) != null)
}

/** Whether what the user typed in a field, in the units shown, is a value it can take */
export function isValidField(key: FieldKey, text: string, units: Units): boolean {
    if (text.trim() === '') return false
    const n = Number(text)
    if (!Number.isFinite(n) || n < 0) return false
    if (WHOLE_NUMBER.has(key) && !Number.isInteger(n)) return false
    // Stored the way a save stores it, then held to the table's limits
    const stored: SetValues = { reps: 0, weightKg: 0, durationS: null, speedKmh: null, inclinePct: null, level: null, distanceM: null, assistKg: null, inputUnit: null }
    storeField(stored, key, n, units)
    if ((Object.keys(STORED_MAX) as (keyof typeof STORED_MAX)[]).some((k) => (stored[k] ?? 0) > STORED_MAX[k])) return false
    // Minutes are saved as whole seconds, which must come to at least one
    if (key === 'minutes') return Math.round(n * 60) > 0
    return MUST_BE_POSITIVE.has(key) ? n > 0 : true
}

/** Stores one typed value (in the units shown) in its column */
function storeField(s: SetValues, key: FieldKey, v: number, units: Units) {
    switch (key) {
        case 'weight':
        case 'added':
            s.weightKg = toStorageKg(v, units.weight)
            break
        case 'assist':
            s.assistKg = toStorageKg(v, units.weight)
            break
        case 'reps':
            s.reps = v
            break
        case 'seconds':
            s.durationS = v
            break
        case 'minutes':
            s.durationS = Math.round(v * 60)
            break
        case 'speed':
            s.speedKmh = toStorageKmh(v, units.distance)
            break
        case 'incline':
            s.inclinePct = v
            break
        case 'level':
            s.level = v
            break
        case 'metres':
            s.distanceM = Math.round(v)
            break
    }
}

/** The set to store, from the value typed in each of the log type's fields (in the units shown) */
export function toStoredSet(logType: LogType, typed: number[], units: Units): SetValues {
    const s: SetValues = {
        reps: 0, weightKg: 0, durationS: null, speedKmh: null, inclinePct: null, level: null, distanceM: null, assistKg: null,
        inputUnit: hasWeight(logType) ? units.weight : null,
    }
    LOG_FIELDS[logType].forEach((key, i) => storeField(s, key, typed[i], units))
    return s
}

/** The units a set's values read in: the kg/lb it was typed in when it kept one, else the ones shown */
export function unitsOfSet(s: SetValues, units: Units): Units {
    return s.inputUnit && s.inputUnit !== units.weight ? { ...units, weight: s.inputUnit } : units
}

/**
 * A logged set with one field typed over (in the units shown), the others as stored, so
 * changing the reps doesn't round the weight through another unit
 */
export function withField(s: SetValues, key: FieldKey, typed: number, units: Units): SetValues {
    const next = { ...s }
    storeField(next, key, typed, units)
    if (isWeightField(key)) next.inputUnit = units.weight
    return next
}

export type SummaryPart =
    | { kind: 'sets'; count: number }
    | { kind: 'best'; weight: number; reps: number }
    | { kind: 'reps'; count: number }
    | { kind: 'seconds'; count: number }
    | { kind: 'minutes'; count: number }
    | { kind: 'distance'; value: number }
    | { kind: 'metres'; value: number }

/** Estimated one-rep max (Epley), the same measure the report uses for a lift's best set */
export const e1rm = (s: { weightKg: number; reps: number }) => s.weightKg * (1 + s.reps / 30)

/**
 * The line under an exercise's name: its sets, then what matters for its type. Strength shows
 * the best set by estimated 1RM, not total volume (volume is for the report's analysis);
 * bodyweight and assisted the total reps; timed work its time; a treadmill its distance
 * (speed x time) and a rower its metres. Empty before the first set.
 */
export function summarize(logType: LogType, sets: SetValues[], units: Units): SummaryPart[] {
    if (!sets.length) return []
    const parts: SummaryPart[] = [{ kind: 'sets', count: sets.length }]
    const fitting = sets.filter((s) => fitsLogType(logType, s))
    // A cardio exercise whose sets were all logged before its log type has only a set count
    if (!fitting.length) return parts
    const sum = (f: (s: SetValues) => number) => fitting.reduce((a, s) => a + f(s), 0)
    const minutes: SummaryPart = { kind: 'minutes', count: round(sum((s) => s.durationS ?? 0) / 60, 1) }
    switch (logType) {
        case 'weight_reps': {
            const best = fitting.reduce((a, b) => (e1rm(b) > e1rm(a) || (e1rm(b) === e1rm(a) && b.reps > a.reps) ? b : a))
            parts.push({ kind: 'best', weight: toDisplayWeight(best.weightKg, units.weight), reps: best.reps })
            break
        }
        case 'bodyweight':
        case 'assisted':
            parts.push({ kind: 'reps', count: sum((s) => s.reps) })
            break
        case 'duration':
            parts.push({ kind: 'seconds', count: sum((s) => s.durationS ?? 0) })
            break
        case 'treadmill':
            parts.push(minutes, { kind: 'distance', value: toDisplayDistance(sum((s) => ((s.speedKmh ?? 0) * (s.durationS ?? 0)) / 3600), units.distance) })
            break
        case 'rower':
            parts.push(minutes, { kind: 'metres', value: sum((s) => s.distanceM ?? 0) })
            break
        case 'cardio_level':
        case 'cardio_time':
            parts.push(minutes)
            break
    }
    return parts
}
