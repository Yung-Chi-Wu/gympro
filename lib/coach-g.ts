// Coach G's requests and the model's routines, checked on the server. Each route accepts only
// these shapes, so a malformed or oversized request gets a 400 instead of a crash, a loop sized
// by the input or a long prompt, and a routine is saved only with library exercises, sets and
// reps in range, and days inside its cycle. The offline check is scripts/check-coach-g.ts.
import { MAX_ROUTINE_NAME_CHARS } from './text-limits'

/** A typed answer, and each saved one: a sentence or a short paragraph */
export const MAX_ANSWER_CHARS = 500
/** The questions: 0 is the greeting, 7 the last */
export const LAST_STEP = 7
/** Coach G plans one week: its first question asks how many days a week the user can train */
export const COACH_CYCLE_DAYS = 7
export const MAX_ROUTINES = 7
export const MAX_EXERCISES_PER_ROUTINE = 15
export const SETS = { min: 1, max: 10 }
export const REPS = { min: 1, max: 100 }
/** The first question's default when its answer has no number in it */
const DEFAULT_TRAINING_DAYS = 4

export type Answer = string | string[] | null
export type Collected = Record<string, Answer>
export const ANSWER_KEYS = ['days', 'duration', 'equipment', 'goals', 'level', 'injuries', 'notes'] as const

export interface PlannedExercise {
    exercise_id: string
    exercise_name: string
    exercise_name_zh_tw?: string
    muscle_group: string
    target_sets: number
    target_reps: number
}

export interface PlannedRoutine {
    name: string
    name_zh_tw?: string
    day_indices: number[]
    exercises: PlannedExercise[]
}

export interface LibraryExercise {
    name: string
    name_zh_tw: string | null
    muscle_group: string
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isShortText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_ANSWER_CHARS
const isIntIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The answers so far, or null when they aren't: only the known keys, each short text, a short list of it, or null */
export function parseCollected(v: unknown): Collected | null {
    if (v === undefined) return {}
    if (!isObject(v)) return null
    const out: Collected = {}
    for (const [key, value] of Object.entries(v)) {
        if (!(ANSWER_KEYS as readonly string[]).includes(key)) return null
        if (value === null || isShortText(value)) out[key] = value
        else if (Array.isArray(value) && value.length <= 10 && value.every(isShortText)) out[key] = value
        else return null
    }
    return out
}

export interface ChatRequest {
    step: number
    answer: string | null
    zh: boolean
    collected: Collected
}

/** A chat request, or null: a step from 0 to 7, the answer to the step before it (none for the greeting), and the answers so far */
export function parseChatRequest(body: unknown): ChatRequest | null {
    if (!isObject(body) || !isIntIn(body.currentStep, 0, LAST_STEP)) return null
    const raw = body.userAnswer ?? null
    const answer = raw === null ? null : isShortText(raw) ? raw : undefined
    if (answer === undefined || (body.currentStep > 0 && !answer?.trim())) return null
    const collected = parseCollected(body.collected)
    return collected ? { step: body.currentStep, answer, zh: body.language === 'zh-TW', collected } : null
}

export interface GenerateRequest {
    /** Days a week to train, 1 to 7, from the first answer */
    trainingDays: number
    duration: string
    equipment: string[]
    goals: string[]
    level: string
    injuries: string | null
    notes: string | null
    zh: boolean
}

const textOf = (v: Answer | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? null)
const listOf = (v: Answer | undefined) => (Array.isArray(v) ? v : v ? [v] : [])

/** The first number in "3 days" or "3天", 1 to 7 */
export function trainingDaysFrom(days: string | null): number {
    const n = Number(days?.match(/\d+/)?.[0])
    return Number.isInteger(n) && n >= 1 ? Math.min(n, COACH_CYCLE_DAYS) : DEFAULT_TRAINING_DAYS
}

/** A request to build the routines from the answers, or null when the answers aren't answers */
export function parseGenerateRequest(body: unknown): GenerateRequest | null {
    if (!isObject(body)) return null
    const c = parseCollected(body.collected)
    if (!c) return null
    return {
        trainingDays: trainingDaysFrom(textOf(c.days)),
        duration: textOf(c.duration) ?? '',
        equipment: listOf(c.equipment),
        goals: listOf(c.goals),
        level: textOf(c.level) ?? '',
        injuries: textOf(c.injuries),
        notes: textOf(c.notes),
        zh: body.language === 'zh-TW',
    }
}

const clamp = (v: unknown, { min, max }: { min: number; max: number }, fallback: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const nameOf = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_ROUTINE_NAME_CHARS) : '')

/**
 * The routines the model wrote, kept to what can be saved: exercises from the list it was given,
 * by id and named as the library names them, once each; sets and reps brought into range; each
 * day of the cycle for one routine at most; and only routines with a day and an exercise.
 */
export function cleanRoutines(raw: unknown, library: Map<string, LibraryExercise>, cycleDays = COACH_CYCLE_DAYS): PlannedRoutine[] {
    if (!Array.isArray(raw)) return []
    const takenDays = new Set<number>()
    const routines: PlannedRoutine[] = []
    for (const r of raw) {
        if (!isObject(r) || routines.length >= MAX_ROUTINES) continue
        const days = (Array.isArray(r.day_indices) ? r.day_indices : [])
            .filter((d): d is number => isIntIn(d, 1, cycleDays) && !takenDays.has(d))
        const exercises: PlannedExercise[] = []
        for (const e of Array.isArray(r.exercises) ? r.exercises : []) {
            const id = isObject(e) && typeof e.exercise_id === 'string' ? e.exercise_id : ''
            const known = library.get(id)
            if (!known || exercises.some((x) => x.exercise_id === id) || exercises.length >= MAX_EXERCISES_PER_ROUTINE) continue
            exercises.push({
                exercise_id: id,
                exercise_name: known.name,
                ...(known.name_zh_tw ? { exercise_name_zh_tw: known.name_zh_tw } : {}),
                muscle_group: known.muscle_group,
                target_sets: clamp((e as Record<string, unknown>).target_sets, SETS, 3),
                target_reps: clamp((e as Record<string, unknown>).target_reps, REPS, 10),
            })
        }
        const uniqueDays = [...new Set(days)]
        if (!uniqueDays.length || !exercises.length) continue
        uniqueDays.forEach((d) => takenDays.add(d))
        const name = nameOf(r.name) || `Routine ${routines.length + 1}`
        const nameZh = nameOf(r.name_zh_tw)
        routines.push({ name, ...(nameZh ? { name_zh_tw: nameZh } : {}), day_indices: uniqueDays, exercises })
    }
    return routines
}

export interface SaveRequest {
    /** Each routine as it is saved: the name in the user's language */
    routines: { name: string; day_indices: number[]; exercises: { exercise_id: string; target_sets: number; target_reps: number }[] }[]
    cycleLength: number
    startDayIndex: number
}

/**
 * What the result card saves, checked whole: the card lets the user change sets and reps (an
 * error the user can fix: 'sets_reps') and remove exercises; anything else wrong is 'invalid'.
 */
export function parseSaveRequest(body: unknown, maxCycleDays: number): SaveRequest | { error: 'invalid' | 'sets_reps' } {
    const invalid = { error: 'invalid' as const }
    if (!isObject(body) || !isIntIn(body.cycleLength, 1, maxCycleDays)) return invalid
    const cycleLength = body.cycleLength
    if (!isIntIn(body.startDayIndex, 1, cycleLength)) return invalid
    const zh = body.language === 'zh-TW'
    const raw = body.routines
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_ROUTINES) return invalid
    const takenDays = new Set<number>()
    const routines: SaveRequest['routines'] = []
    for (const r of raw) {
        if (!isObject(r)) return invalid
        const name = nameOf(zh && typeof r.name_zh_tw === 'string' && r.name_zh_tw.trim() ? r.name_zh_tw : r.name)
        if (!name) return invalid
        const days = r.day_indices
        if (!Array.isArray(days) || !days.every((d) => isIntIn(d, 1, cycleLength) && !takenDays.has(d)) || new Set(days).size !== days.length) return invalid
        days.forEach((d) => takenDays.add(d))
        const exercises = r.exercises
        if (!Array.isArray(exercises) || exercises.length > MAX_EXERCISES_PER_ROUTINE) return invalid
        const ids = new Set<string>()
        for (const e of exercises) {
            if (!isObject(e) || typeof e.exercise_id !== 'string' || !UUID.test(e.exercise_id) || ids.has(e.exercise_id)) return invalid
            ids.add(e.exercise_id)
            if (!isIntIn(e.target_sets, SETS.min, SETS.max) || !isIntIn(e.target_reps, REPS.min, REPS.max)) return { error: 'sets_reps' }
        }
        routines.push({
            name,
            day_indices: days,
            exercises: exercises.map((e) => ({ exercise_id: e.exercise_id, target_sets: e.target_sets, target_reps: e.target_reps })),
        })
    }
    return { routines, cycleLength, startDayIndex: body.startDayIndex }
}
