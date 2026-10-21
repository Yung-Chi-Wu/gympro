import type { PlanCard, RecommendationCard } from './conversation'
import type { LibraryExercise, PlannedExercise, RonnieData, RoutineProposal, WorkoutSet } from './data'
import { COACH_CYCLE_DAYS, type PlannedRoutine } from '../coach-g'
import {
    buildPlan, EQUIPMENT, GOALS, includeLeftOut, LEVELS, MAX_INCLUDE, SESSION_MINUTES,
    type CoachPreferences, type LeftOutReason, type PlannerExercise,
} from '../coach-g-planner'
import { JOINTS } from '../exercise-attributes'
import { isTarget, TARGET_REPS, TARGET_SETS } from '../targets'
import { namesOf, type LoggedToday } from './reply-check'
import { VOLUME_UNIT_IDS } from '../report/volume'
import { describeProposal } from './events'
import { gatedSearch, latinTokens, searchLibrary } from './search'
import {
    INJURY_SITES, MAX_NOTE_CHARS, MAX_NOTES, MAX_OTHER_NOTES, MEMORY_STATES, isActiveInjury, isDislike, isInjurySite, isMemoryKind,
    memoryReceipt, noteIdOf, sameSlot, type MemoryKind, type MemoryNote,
} from './memory'
import { localDateStr, localDateToUtcRange } from './time'
import { formatWeight, toDisplayWeight, type WeightUnit } from '../weight-unit'
import { toDisplayDistance, type DistanceUnit } from '../distance-unit'
import type { LogType } from '../exercise-attributes'
import { e1rm, fieldValue, fitsLogType, isCardio, logNoteOf, type LogNote, type SetValues } from '../set-log'

// Ronnie's tools. Results are for the model, so they are in English whatever the
// user's language; exercise names follow the user's language (Ronnie quotes them),
// and the lines the user sees (confirmations) are localized. Exercises are listed
// with IDs so the model never guesses one, and numbers are computed here.

export interface RonnieExecutorContext {
    data: RonnieData
    language: string
    timeZone: string
    todayRoutineName: string | null
    /** Sets are stored in kg; tool results give weights in the user's unit, which is what Ronnie must answer in */
    weightUnit?: WeightUnit
    /** Likewise km or mi, for treadmill speed and distance */
    distanceUnit?: DistanceUnit
    now?: () => Date
}

export interface RonnieExecutor {
    executeTool(toolName: string, toolInput: Record<string, string>): Promise<string>
    /** True once a tool changed today's workout, so the dashboard should reload. */
    readonly needsDashboardReload: boolean
    /** Routine changes proposed this turn, shown as cards to confirm. */
    readonly proposals: (RoutineProposal & { id: string })[]
    /** Exercises recommended this turn, shown as cards with an Add to today or a Swap button. */
    readonly recommendations: RecommendationCard[]
    /** The week Coach G's planner built this turn (one at most), shown as a card that opens Coach G's editor. */
    readonly plans: PlanCard[]
    /** What this turn changed or proposed, in the user's language: the reply when the model's can't be used. */
    readonly confirmations: string[]
    /** What was asked for but not proposed, in the user's language: said alongside the confirmations. */
    readonly notices: string[]
    /**
     * The notes this turn saved, updated or forgot, as the lines shown with the reply (memoryReceipt).
     * Written here, never by the model, so the user sees exactly what was kept and nothing is
     * claimed that wasn't.
     */
    readonly remembered: string[]
    /** Today's exercises with every name each goes by and whether it has sets, to check a reply against (reply-check.ts) */
    todayLog(): Promise<LoggedToday[]>
}

// Results show the first 8 characters of an exercise ID (the model mis-copied full UUIDs);
// inputs are resolved back. A prefix two exercises share is shown in full.
const SHORT_ID_LENGTH = 8
const UNKNOWN_ID = 'Unknown exercise ID - look it up with search_exercises first'

/** A filter value as the tools take it: "upper chest" and "Lower-Back" are upper_chest and lower_back. */
const vocabulary = (value: string | undefined) => value?.trim().toLowerCase().replace(/[\s-]+/g, '_') || undefined
const isOneOf = <T extends string>(choices: readonly T[], v: unknown): v is T => (choices as readonly unknown[]).includes(v)

/**
 * The routine a name means: the exact name (any case), else the only one containing it. Two
 * that contain it and none exactly is a question for the user: "Leg Day" must not pick "Leg Day B".
 */
function pickRoutine<T extends { name: string }>(found: T[], name: string): { routine: T } | { ambiguous: T[] } | { none: true } {
    const wanted = name.trim().toLowerCase()
    const exact = found.filter((r) => r.name.trim().toLowerCase() === wanted)
    if (exact.length === 1) return { routine: exact[0] }
    if (found.length === 1) return { routine: found[0] }
    return found.length ? { ambiguous: exact.length ? exact : found } : { none: true }
}

/** A whole number in the target's range (the model may send it as a string), else the default */
function targetOr(value: unknown, range: { min: number; max: number }, fallback: number): number {
    const n = Number(value)
    return isTarget(n, range) ? n : fallback
}

type Named = { exercise_id: string; exercises: { name: string; name_zh_tw: string | null } | null }

/**
 * Today's exercises a name refers to: an exact name, else names containing it, comparing English
 * by singular words ("tricep pushdowns" → Triceps Pushdown). Never the other way round: "side plank"
 * must not remove Plank. No single match means the caller lists today's exercises instead of guessing.
 */
function matchByName<T extends Named>(planned: T[], query: string | undefined): T[] {
    const q = String(query ?? '').trim().toLowerCase()
    if (!q) return []
    const qWords = latinTokens(q)
    const names = (pe: T) => [pe.exercises?.name, pe.exercises?.name_zh_tw].filter((n): n is string => !!n).map((n) => n.toLowerCase())
    const exact = planned.filter((pe) => names(pe).includes(q))
    const found = exact.length ? exact : planned.filter((pe) => names(pe).some((n) => {
        const words = latinTokens(n)
        return n.includes(q) || (qWords.length > 0 && qWords.every((w) => words.includes(w)))
    }))
    return found.filter((pe, i) => found.findIndex((x) => x.exercise_id === pe.exercise_id) === i)
}

/** How a set of it is logged, when that isn't obvious: what the app's logging screen says too */
const LOG_NOTE_TEXT: Record<LogNote, string> = {
    per_side: "logged one side at a time: one side's numbers, both sides done count as one set",
    one_dumbbell: 'weight logged is one dumbbell',
}

/**
 * A search result's detail: its group, the muscles it mainly trains, any joint it loads more
 * than lightly (marked when the user's notes have that joint injured), and how a set is logged
 * when that isn't obvious.
 */
function describe(e: LibraryExercise, injured: Set<string | null> = new Set()): string {
    const loads = Object.entries(e.joint_load ?? {}).filter(([, level]) => level !== 'low')
        .map(([joint, level]) => `${joint.replace('_', ' ')} ${level}${injured.has(joint) ? ' (injured, in your notes)' : ''}`)
    const note = logNoteOf(e)
    return [
        e.muscle_group,
        e.primary_muscles.length ? `trains ${e.primary_muscles.join(', ').replace(/_/g, ' ')}` : '',
        loads.length ? `joint load: ${loads.join(', ')}` : e.joint_load ? 'low joint load' : '',
        note ? LOG_NOTE_TEXT[note] : '',
    ].filter(Boolean).join('; ')
}

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const shiftDate = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
}
const mondayOf = (iso: string) => shiftDate(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7))

export function createRonnieExecutor({ data, language, timeZone, todayRoutineName, weightUnit = 'kg', distanceUnit = 'km', now = () => new Date() }: RonnieExecutorContext): RonnieExecutor {
    const zh = language === 'zh-TW'
    let needsDashboardReload = false
    const proposals: (RoutineProposal & { id: string })[] = []
    const recommendations: RecommendationCard[] = []
    const plans: PlanCard[] = []
    const confirmations: string[] = []
    const notices: string[] = []
    const remembered: string[] = []
    const notice = (zhLine: string, enLine: string) => notices.push(zh ? zhLine : enLine)

    const nameOf = (ex: { name: string; name_zh_tw: string | null } | null | undefined) =>
        (zh && ex?.name_zh_tw ? ex.name_zh_tw : ex?.name) ?? 'Unknown'
    const units = { weight: weightUnit, distance: distanceUnit }
    // A bodyweight set is logged at 0 kg; said outright, since the model read 8×0kg as an assisted machine
    const repsText = (s: SetValues) => (s.weightKg === 0 ? `${s.reps} reps (bodyweight)` : `${s.reps}×${formatWeight(s.weightKg, weightUnit)}`)
    /**
     * A set the way its exercise is logged. Cardio, timed and assisted sets keep their values outside
     * reps and weight, so read as reps x weight a treadmill set was "0 reps (bodyweight)" (2026-10-12).
     * A set logged before its exercise had a log type has only reps x weight, and reads that way.
     */
    const setText = (logType: LogType, s: SetValues) => {
        if (!fitsLogType(logType, s)) return repsText(s)
        const v = (key: Parameters<typeof fieldValue>[0]) => fieldValue(key, s, units)
        switch (logType) {
            case 'weight_reps': return repsText(s)
            case 'bodyweight': return s.weightKg === 0 ? repsText(s) : `${s.reps} reps, +${formatWeight(s.weightKg, weightUnit)} added`
            case 'assisted': return `${s.reps} reps, ${formatWeight(s.assistKg ?? 0, weightUnit)} assist (less assist is progress)`
            case 'duration': return `${s.durationS} s`
            case 'treadmill': return `${v('minutes')} min at ${v('speed')} ${distanceUnit === 'mi' ? 'mph' : 'km/h'}, ${v('incline')}% incline`
            case 'cardio_level': return `${v('minutes')} min at level ${v('level')}`
            case 'rower': return `${v('minutes')} min, ${v('metres')} m`
            case 'cardio_time': return `${v('minutes')} min`
        }
    }
    const targets = (r: { target_sets: number | null; target_reps: number | null }) => `${r.target_sets ?? '?'} sets x ${r.target_reps ?? '?'} reps`
    /** A change to today's workout, worded for the user: also the tool's result. */
    const changed = (zhLine: string, enLine: string) => {
        needsDashboardReload = true
        const line = zh ? zhLine : enLine
        confirmations.push(line)
        return line
    }
    const todayRange = () => localDateToUtcRange(localDateStr(now(), timeZone), timeZone)
    // One lookup of today's workout per turn: the model calls tools in parallel, and two removals
    // each creating today's workout made two of them, so later changes went to the one not shown (2026-10-09)
    let todayWorkout: Promise<string | null> | null = null
    const ensureTodayWorkout = () => (todayWorkout ??= data.ensureTodayWorkout())
    const workoutsBetween = (from: string, to: string) =>
        data.getWorkoutsBetween(localDateToUtcRange(from, timeZone).start, localDateToUtcRange(to, timeZone).end)

    let library: LibraryExercise[] | null = null
    const exercises = async () => (library ??= await data.listExercises())
    const findExercise = async (id: string) => (await exercises()).find((e) => e.id === id)
    /** Each exercise's log type, for describing its sets */
    const logTypes = async () => new Map((await exercises()).map((e) => [e.id, e.log_type]))
    const setsText = (types: Map<string, LogType>, sets: WorkoutSet[]) => sets.map((s) => setText(types.get(s.exercise_id) ?? 'weight_reps', s)).join(', ')
    async function shortId(id: string): Promise<string> {
        const prefix = id.slice(0, SHORT_ID_LENGTH)
        return (await exercises()).filter((e) => e.id.startsWith(prefix)).length > 1 ? id : prefix
    }
    /** A full UUID, or the short form shown in results, back to the full ID. */
    async function resolveId(raw: string): Promise<string> {
        const value = raw.trim().toLowerCase()
        const ids = (await exercises()).map((e) => e.id)
        if (ids.includes(value)) return value
        const matches = value.length >= SHORT_ID_LENGTH ? ids.filter((x) => x.startsWith(value.slice(0, SHORT_ID_LENGTH))) : []
        return matches.length === 1 ? matches[0] : value
    }
    const listLine = async (id: string, name: string, detail?: string) => `ID: ${await shortId(id)} | ${name}${detail ? `: ${detail}` : ''}`

    // The user's notes, read once per turn and kept up to date by this turn's own writes. The
    // filters go on without them if they can't be read; remember and forget fail instead.
    let memory: Promise<MemoryNote[]> | null = null
    const notes = () => (memory ??= data.listMemories().then((list) => [...list]))
    const notesOrNone = () => notes().catch((): MemoryNote[] => [])
    const dislikes = async () => new Set((await notesOrNone()).filter(isDislike).map((n) => n.subject))
    /** An exercise the user named: the query holds its name (a search for it, not for something like it) */
    const named = (e: LibraryExercise, query: string | undefined) => {
        const q = String(query ?? '').trim().toLowerCase()
        return !!q && (q.includes(e.name.toLowerCase()) || (!!e.name_zh_tw && q.includes(e.name_zh_tw)))
    }
    /** An exercise by ID, else by its exact name in either language */
    async function exerciseFor(input: Record<string, string>): Promise<LibraryExercise | undefined> {
        if (input.exercise_id) return findExercise(input.exercise_id)
        const name = String(input.exercise_name ?? '').trim().toLowerCase()
        const found = name ? (await exercises()).filter((e) => e.name.toLowerCase() === name || e.name_zh_tw?.toLowerCase() === name) : []
        return found.length === 1 ? found[0] : undefined
    }
    /**
     * The slot a remember or forget call means, or why it can't be one. An other note is the one
     * its note_id names; without one, remember starts a new note with an ID of its own.
     */
    async function slotOf(kind: MemoryKind, input: Record<string, string>, adding: boolean): Promise<{ subject: string | null; label: string } | { error: string }> {
        if (kind === 'other') {
            const noteId = String(input.note_id ?? '').trim().toLowerCase()
            if (!noteId) return adding ? { subject: crypto.randomUUID(), label: 'a new other note' } : { error: 'An other note is named by its note_id, from your notes' }
            const list = await notes()
            const found = list.filter((n) => n.kind === 'other' && n.subject?.startsWith(noteId))
            if (found.length === 1) return { subject: found[0].subject, label: `other note ${noteIdOf(found[0].subject!, list)}` }
            return { error: found.length ? `Several other notes start with ${noteId}: use the whole note ID` : `No other note has the ID ${noteId}; the IDs are in your notes` }
        }
        if (kind === 'injury') {
            const joint = vocabulary(input.joint)
            return isInjurySite(joint) ? { subject: joint, label: `${joint.replace('_', ' ')} injury` } : { error: `An injury note needs joint, one of: ${INJURY_SITES.join(', ')}` }
        }
        if (kind === 'exercise') {
            const exercise = await exerciseFor(input)
            if (exercise) return { subject: exercise.id, label: `"${nameOf(exercise)}"` }
            return { error: input.exercise_id ? UNKNOWN_ID : `No exercise is named exactly "${input.exercise_name ?? ''}": find it with search_exercises and pass its exercise_id` }
        }
        return { subject: null, label: kind }
    }
    /**
     * A workout's exercises: the planned ones, then any with sets that were taken off the plan
     * afterwards. Removing an exercise keeps its sets, and History and the report count them, so
     * Ronnie must see them too (it listed only the plan).
     */
    const workoutExercises = async (planned: PlannedExercise[], sets: WorkoutSet[]) => {
        const plannedIds = new Set(planned.map((pe) => pe.exercise_id))
        const unplanned = [...new Set(sets.map((s) => s.exercise_id))].filter((id) => !plannedIds.has(id))
        const names = await Promise.all(unplanned.map(async (id) => ({ exercise_id: id, exercises: (await findExercise(id)) ?? null, unplanned: true })))
        return [...planned.map((pe) => ({ ...pe, unplanned: false })), ...names]
    }
    const unplannedNote = ' (logged, then taken off today\'s plan)'

    const tools: Record<string, (input: Record<string, string>) => Promise<string>> = {
        async get_routine_exercises(input) {
            const picked = pickRoutine(await data.findRoutinesByName(input.routine_name), input.routine_name)
            if ('none' in picked) return `No routine named "${input.routine_name}"`
            if ('ambiguous' in picked) return `Several routines match "${input.routine_name}": ${picked.ambiguous.map((r) => r.name).join(', ')}. Ask the user which one, or call again with the exact name.`
            const { routine } = picked
            const rows = await data.getRoutineExercises(routine.id)
            if (!rows.length) return `"${routine.name}" has no exercises`
            const lines = await Promise.all(rows.map((r) => listLine(r.exercise_id, nameOf(r.exercises), targets(r))))
            return `"${routine.name}":\n${lines.join('\n')}`
        },

        async search_exercises(input) {
            const [library, list] = await Promise.all([exercises(), notesOrNone()])
            const query = input.query?.trim()
            const filter = { muscle: vocabulary(input.muscle), lowLoadOn: vocabulary(input.low_load_on) }
            const nearest = query ? await data.nearestExercises(query) : null
            // An exercise the user doesn't want recommended is left out, unless they named it: room
            // for those is kept, so ten others still come back
            const disliked = new Set(list.filter(isDislike).map((n) => n.subject))
            const ranked = gatedSearch(library, searchLibrary(library, query, filter, 20 + disliked.size), nearest, 10 + disliked.size, filter)
            const leftOut = ranked.exercises.filter((e) => disliked.has(e.id) && !named(e, query))
            const found = ranked.exercises.filter((e) => !leftOut.includes(e)).slice(0, 10)
            const without = leftOut.length ? `\nLeft out, as the user doesn't want ${leftOut.length > 1 ? 'them' : 'it'} recommended (your notes): ${leftOut.map(nameOf).join(', ')}` : ''
            if (!found.length) return `No exercises found${filter.lowLoadOn ? ` with low ${filter.lowLoadOn} load` : ''}. Try other wording (English or Chinese, a shorter keyword) or another muscle.${without}`
            const injured = new Set(list.filter(isActiveInjury).map((n) => n.subject))
            const lines = (await Promise.all(found.map((e) => listLine(e.id, nameOf(e), describe(e, injured))))).join('\n')
            return `${ranked.exact ? lines : `Nothing in the library matches "${input.query}" exactly. Closest:\n${lines}`}${without}`
        },

        async get_workout_history(input) {
            const workouts = await workoutsBetween(input.date_from, input.date_to)
            if (!workouts.length) return 'No workouts in this period'
            const [sets, types] = await Promise.all([data.getSets(workouts.map((w) => w.id)), logTypes()])
            const days = await Promise.all(workouts.map(async (w) => {
                const date = localDateStr(new Date(w.performed_at), timeZone)
                const own = sets.filter((s) => s.workout_id === w.id)
                const lines = (await workoutExercises(w.workout_planned_exercises ?? [], own)).map((pe) => {
                    const done = setsText(types, own.filter((s) => s.exercise_id === pe.exercise_id))
                    return `  ${nameOf(pe.exercises)}${pe.unplanned ? unplannedNote : ''}: ${done || 'no sets logged'}`
                })
                return `${date} (${weekdayOf(date)}):\n${lines.join('\n')}`
            }))
            return days.join('\n\n')
        },

        async get_today_workout() {
            const range = todayRange()
            const workout = await data.getLatestWorkoutBetween(range.start, range.end)
            if (workout) {
                const [sets, types] = await Promise.all([data.getSets([workout.id]), logTypes()])
                const rows = await Promise.all((await workoutExercises(workout.workout_planned_exercises ?? [], sets)).map(async (pe) => {
                    const done = setsText(types, sets.filter((s) => s.exercise_id === pe.exercise_id))
                    return { done: !!done, line: await listLine(pe.exercise_id, `${nameOf(pe.exercises)}${pe.unplanned ? unplannedNote : ''}`, done) }
                }))
                if (!rows.length) return 'Nothing planned today'
                // Apart, each in today's order: in one list a reply took an exercise still to do as done
                const group = (title: string, lines: string[], none: string) => (lines.length ? [`${title}:`, ...lines] : [`${title}: ${none}`])
                return [
                    ...group('Done today', rows.filter((r) => r.done).map((r) => r.line), 'nothing yet'),
                    ...group("Not done yet, no sets logged (still to come today: don't say they're done or already trained)", rows.filter((r) => !r.done).map((r) => r.line), 'none'),
                ].join('\n')
            }
            const routineId = await data.getTodayRoutineId()
            const plan = routineId ? await data.getRoutineExercises(routineId) : []
            if (!plan.length) return 'Rest day: no routine today'
            const lines = await Promise.all(plan.map((r) => listLine(r.exercise_id, nameOf(r.exercises), `${targets(r)} planned`)))
            return `Today's routine "${todayRoutineName}", not started yet:\n${lines.join('\n')}`
        },

        async add_exercise_today(input) {
            const exercise = await findExercise(input.exercise_id)
            if (!exercise) return UNKNOWN_ID
            const workoutId = await ensureTodayWorkout()
            if (!workoutId) return "Could not create today's workout"
            // Already planned (today's routine may have it): the table allows it once, and the raw
            // constraint error read as a failure to add
            const range = todayRange()
            const planned = (await data.getLatestWorkoutBetween(range.start, range.end))?.workout_planned_exercises ?? []
            if (planned.some((pe) => pe.exercise_id === exercise.id)) return `"${nameOf(exercise)}" is already in today's workout; nothing added.`
            const error = await data.addPlannedExercise(workoutId, exercise.id)
            if (error) return `Not added: ${error}`
            const line = changed(`✓ 已將「${nameOf(exercise)}」加入今天的課表`, `✓ Added "${nameOf(exercise)}" to today's workout`)
            // The user's own choice goes ahead; trying it once doesn't change the note by itself
            return (await dislikes()).has(exercise.id)
                ? `${line}. Your notes say the user doesn't want it recommended: ask once whether to clear that, and change the note only if they say yes.`
                : line
        },

        async remove_exercise_today(input) {
            const workoutId = await ensureTodayWorkout()
            if (!workoutId) return "Could not create today's workout"
            // A name is enough: needing an ID meant a lookup first, and the model sometimes stopped after it
            let id = input.exercise_id
            let name = input.exercise_name
            if (!id) {
                const range = todayRange()
                const planned = (await data.getLatestWorkoutBetween(range.start, range.end))?.workout_planned_exercises ?? []
                const matches = matchByName(planned, name)
                if (matches.length !== 1) {
                    if (!planned.length) return "Today's workout is empty; nothing to remove"
                    const list = (await Promise.all(planned.map((pe) => listLine(pe.exercise_id, nameOf(pe.exercises))))).join('\n')
                    const why = matches.length ? `Several of today's exercises match "${name}"` : `"${name}" is not in today's workout`
                    return `${why}; nothing was removed. Today's exercises:\n${list}\nCall again with exercise_id, or ask the user which one.`
                }
                id = matches[0].exercise_id
                name = nameOf(matches[0].exercises)
            }
            // Called with an ID alone, the confirmation still names the exercise
            name ||= nameOf(await findExercise(id))
            const { error, removed } = await data.removePlannedExercise(workoutId, id)
            if (error) return `Not removed: ${error}`
            // An unknown ID removes nothing: say so instead of a false success
            if (!removed) return "That exercise isn't in today's workout; nothing was removed. Get the ID from get_today_workout."
            return changed(`✓ 已將「${name}」從今天課表移除（不影響固定課表）`, `✓ Removed "${name}" from today only (routines unchanged)`)
        },

        // The user's own choice is done right away (add/remove above); Ronnie's choice waits for
        // the user's tap, and a swap card swaps both at once so nothing is left half done.
        async recommend_exercise(input) {
            const exercise = await findExercise(input.exercise_id)
            if (!exercise) return UNKNOWN_ID
            if ((await dislikes()).has(exercise.id)) return `No card shown: your notes say the user doesn't want "${nameOf(exercise)}" recommended. Recommend another; if they asked for it by name, add it with add_exercise_today.`
            // Today's exercises, or the routine's plan if today's workout hasn't started
            const range = todayRange()
            const workout = await data.getLatestWorkoutBetween(range.start, range.end)
            const routineId = workout ? null : await data.getTodayRoutineId()
            const planned = workout?.workout_planned_exercises ?? (routineId ? await data.getRoutineExercises(routineId) : [])
            if (planned.some((pe) => pe.exercise_id === exercise.id)) return `"${nameOf(exercise)}" is already in today's workout; no card shown. Recommend another, or tell the user.`
            if (!input.replaces_exercise_id) {
                recommendations.push({ exerciseId: exercise.id, exerciseName: nameOf(exercise) })
                return `Showing a card for "${nameOf(exercise)}" with an Add to today button.`
            }
            const replaced = planned.find((pe) => pe.exercise_id === input.replaces_exercise_id)
            if (!replaced) return "The exercise to replace isn't in today's workout; no card shown. Get its ID from get_today_workout."
            const replacesName = nameOf(replaced.exercises)
            recommendations.push({ exerciseId: exercise.id, exerciseName: nameOf(exercise), replacesExerciseId: replaced.exercise_id, replacesName })
            return `Showing a card that swaps "${replacesName}" for "${nameOf(exercise)}" in today's workout. Nothing changes until the user taps Swap on it. Say which exercise you suggest and why, and that Swap on the card makes the change.`
        },

        get_training_summary: (input) => trainingSummary(input.date_from, input.date_to),

        async propose_routine_change(input) {
            // Only proposed: the change happens when the user confirms it in the app, each card on
            // its own, so there is no cap on how many one turn proposes (the owner, 2026-10-14).
            // No default: a missing change once read as a removal of an exercise the user asked to add
            if (input.change !== 'add' && input.change !== 'remove') return 'Not proposed: say change "add" or "remove"'
            const add = input.change === 'add'
            const exercise = await findExercise(input.exercise_id)
            if (!exercise) return UNKNOWN_ID
            const exerciseName = nameOf(exercise)
            const containing = await data.findRoutinesWithExercise(exercise.id)
            let proposal: RoutineProposal
            if (add) {
                if (!input.routine_name) return 'Adding needs routine_name: the routine to add it to'
                const picked = pickRoutine(await data.findRoutinesByName(input.routine_name), input.routine_name)
                if ('ambiguous' in picked) {
                    const names = picked.ambiguous.map((r) => r.name)
                    notice(`有好幾個課表符合「${input.routine_name}」：${names.join('、')}，「${exerciseName}」要加到哪一個？`,
                        `Several routines match "${input.routine_name}" (${names.join(', ')}): which one should "${exerciseName}" go into?`)
                    return `Several routines match "${input.routine_name}": ${names.join(', ')}; pick one`
                }
                if ('none' in picked) {
                    notice(`找不到叫「${input.routine_name}」的課表，「${exerciseName}」沒有加入。`, `There's no routine called "${input.routine_name}", so "${exerciseName}" wasn't added.`)
                    return `No routine named "${input.routine_name}"`
                }
                const { routine } = picked
                if (containing.some((r) => r.id === routine.id)) {
                    notice(`「${exerciseName}」已經在「${routine.name}」裡了。`, `"${exerciseName}" is already in "${routine.name}".`)
                    return `"${exerciseName}" is already in "${routine.name}"; nothing to add`
                }
                proposal = {
                    change: 'add_exercise',
                    exerciseId: exercise.id,
                    exerciseName,
                    routineIds: [routine.id],
                    routineNames: [routine.name],
                    targetSets: targetOr(input.target_sets, TARGET_SETS, 3),
                    targetReps: targetOr(input.target_reps, TARGET_REPS, 10),
                }
            } else {
                // "Upper" removes it from "Upper", not also from "Upper Power": the routine means only one
                let routines = containing
                if (input.routine_name) {
                    const matching = containing.filter((r) => r.name.toLowerCase().includes(input.routine_name.trim().toLowerCase()))
                    const picked = pickRoutine(matching, input.routine_name)
                    if ('ambiguous' in picked) {
                        const names = picked.ambiguous.map((r) => r.name)
                        notice(`有好幾個課表符合「${input.routine_name}」：${names.join('、')}，要從哪一個移除「${exerciseName}」？`,
                            `Several routines match "${input.routine_name}" (${names.join(', ')}): which one should "${exerciseName}" come out of?`)
                        return `Several routines with "${exerciseName}" match "${input.routine_name}": ${names.join(', ')}; ask which one, or omit routine_name for all of them`
                    }
                    routines = 'routine' in picked ? [picked.routine] : []
                }
                if (!routines.length) {
                    notice(`「${exerciseName}」不在${input.routine_name ? `「${input.routine_name}」` : '任何課表'}裡，沒有要移除的。`,
                        `"${exerciseName}" isn't in ${input.routine_name ? `"${input.routine_name}"` : 'any routine'}, so there's nothing to remove.`)
                    return `"${exerciseName}" is not in ${input.routine_name ? `"${input.routine_name}"` : 'any routine'}; nothing to change`
                }
                proposal = { change: 'remove_exercise', exerciseId: exercise.id, exerciseName, routineIds: routines.map((r) => r.id), routineNames: routines.map((r) => r.name) }
            }

            const saved = await data.createProposal(proposal)
            if ('error' in saved) return `The proposal was not saved: ${saved.error}`
            proposals.push({ ...proposal, id: saved.id })
            // The turn's reply is these words (see agent.ts): given the wording, the model still said "Done!"
            confirmations.push(zh ? `已準備好：${describeProposal(proposal, true)}，在 app 裡按「確認」後生效。` : `Ready: ${describeProposal(proposal, false)} - tap Confirm in the app to apply.`)
            // Said outright: the model guessed which routines had it, and a guess counts as invented
            const scope = !add && !input.routine_name ? ' (the only routines with this exercise)' : ''
            return `Proposed, not applied yet: ${describeProposal(proposal, false)}${scope}. It takes effect when the user confirms it in the app.`
        },

        // Coach G's planner as a tool: code builds the week from what Ronnie gathered, the card shows
        // it, and only Coach G's editor, which the card opens, saves it
        async plan_routines(input) {
            const raw = input as unknown as Record<string, unknown>
            const list = <T extends string>(choices: readonly T[], v: unknown): T[] => Array.isArray(v)
                ? [...new Set(v.map((x) => vocabulary(String(x))).filter((x): x is T => (choices as readonly unknown[]).includes(x)))]
                : []
            const days = Number(raw.days)
            const minutes = Number(raw.minutes)
            const level = vocabulary(String(raw.level ?? ''))
            const goals = list(GOALS, raw.goals)
            if (!Number.isInteger(days) || days < 1 || days > COACH_CYCLE_DAYS) return `Not planned: days is training days a week, 1 to ${COACH_CYCLE_DAYS}`
            if (!Number.isFinite(minutes) || minutes <= 0) return `Not planned: minutes is the session length, one of ${SESSION_MINUTES.join(', ')}`
            if (!isOneOf(LEVELS, level)) return `Not planned: level is one of ${LEVELS.join(', ')}`
            if (!goals.length) return `Not planned: goals is one or more of ${GOALS.join(', ')}`

            const [library, noteList] = await Promise.all([exercises(), notesOrNone()])
            const ids = async (v: unknown) => (Array.isArray(v) ? [...new Set(await Promise.all(v.map((x) => resolveId(String(x)))))] : [])
            const include = await ids(raw.include)
            // The notes hold whatever the call says: their injured joints are spared, and what they
            // don't want is left out, unless the user asked for it this time
            const injured = noteList.filter(isActiveInjury).map((n) => String(n.subject))
            const disliked = noteList.filter(isDislike).map((n) => String(n.subject))
            const p: CoachPreferences = {
                days,
                minutes: SESSION_MINUTES.reduce((best, m) => (Math.abs(m - minutes) < Math.abs(best - minutes) ? m : best)),
                equipment: list(EQUIPMENT, raw.equipment),
                goals,
                level,
                injuries: [...new Set([...list(JOINTS, raw.injuries), ...injured.filter((j): j is (typeof JOINTS)[number] => isOneOf(JOINTS, j))])],
                avoid: [...new Set([...(await ids(raw.avoid)), ...disliked.filter((id) => !include.includes(id))])],
                prioritize: list(VOLUME_UNIT_IDS, raw.prioritize),
                include,
            }
            // The library as the planner reads it: joint loads are rated low, medium or high
            const plannerLibrary = library as unknown as PlannerExercise[]
            const routines = buildPlan(p, plannerLibrary)
            if (!routines.length) return 'Not planned: no exercise in the library fits these choices. Ask about their equipment again.'
            // One plan a turn: a second call replaces the first card
            const replaced = plans.length > 0
            plans.splice(0, plans.length, { id: crypto.randomUUID(), routines, cycleLength: COACH_CYCLE_DAYS })

            const byId = new Map(library.map((e) => [e.id, e]))
            const routineName = (r: PlannedRoutine) => (zh && r.name_zh_tw) || r.name
            const exerciseName = (x: PlannedRoutine['exercises'][number]) => (zh && x.exercise_name_zh_tw) || x.exercise_name
            const why: Record<LeftOutReason, string> = {
                not_in_library: 'not in the library',
                avoided: "also among the exercises they don't want",
                injured_joint: 'heavy on an injured joint',
                no_muscles: "cardio, which the planner doesn't place: suggest it as a warm-up or on its own",
                over_limit: `past the ${MAX_INCLUDE} exercises a plan keeps`,
            }
            const spared = [
                p.injuries.length ? `sparing the ${p.injuries.map((j) => j.replace('_', ' ')).join(', ')}` : '',
                p.avoid.length ? `without ${p.avoid.map((id) => nameOf(byId.get(id))).join(', ')}` : '',
            ].filter(Boolean)
            const keptDisliked = include.filter((id) => disliked.includes(id))
            const training = routines.flatMap((r) => r.day_indices).sort((a, b) => a - b)
            const rest = Array.from({ length: COACH_CYCLE_DAYS }, (_, i) => i + 1).filter((d) => !training.includes(d))
            // And counted in a row, as a reply puts it: one read rest days 6 and 7 as "three off"
            const inARow: { training: boolean; days: number }[] = []
            for (let d = 1; d <= COACH_CYCLE_DAYS; d++) {
                const last = inARow[inARow.length - 1]
                if (last?.training === training.includes(d)) last.days++
                else inARow.push({ training: training.includes(d), days: 1 })
            }
            return [
                `${replaced ? 'Replaced the earlier card with' : 'Showing'} Coach G's plan as a card: ${p.days} days a week, ${p.minutes} min a session, ${p.goals.join(' and ').replace(/_/g, ' ')}, ${p.level}${spared.length ? `, ${spared.join(', ')}` : ''}.`,
                ...routines.map((r) => `${routineName(r)} (day ${r.day_indices.join(', ')} of the week): ${r.exercises.map((x) => `${exerciseName(x)} ${x.target_sets}x${x.target_reps}`).join(', ')}`),
                // Said outright: worked out from the routines' days, a reply put the rest days on the wrong ones
                `Training days ${training.join(', ')}; rest days ${rest.length ? rest.join(', ') : 'none'}; in a row: ${inARow.map((r) => `${r.days} ${r.training ? 'training' : 'rest'}`).join(', ')}. Day 1 is the day the user picks as the cycle's first when saving, not a weekday.`,
                ...includeLeftOut(p, plannerLibrary).map((x) => `Not in the plan: ${byId.has(x.id) ? nameOf(byId.get(x.id)) : `the ID ${x.id}`} (${why[x.reason]})`),
                ...(keptDisliked.length ? [`Kept as asked, though your notes say they don't want it: ${keptDisliked.map((id) => nameOf(byId.get(id))).join(', ')}. Ask once whether to change that note.`] : []),
                "Nothing is saved yet: the user opens the card, can edit it, and saving there replaces all their routines and their training cycle. The app says so under your reply, so don't say it, and don't open with ✅: nothing is done yet. Say how the week is laid out and what you fitted to them, not every exercise (the card lists them), and what you assumed.",
            ].join('\n')
        },

        // A slot's note is replaced here, by its kind and subject, never added beside the old one,
        // and the line the user sees is written here from what was stored
        async remember(input) {
            if (!isMemoryKind(input.kind)) return 'Not saved: kind is injury, exercise, equipment or schedule'
            const kind = input.kind
            const slot = await slotOf(kind, input, true)
            if ('error' in slot) return `Not saved: ${slot.error}`
            const states = MEMORY_STATES[kind]
            if (kind === 'exercise' && !input.state) return 'Not saved: an exercise note needs state, like or dislike'
            const state = kind === 'injury' || kind === 'exercise' ? vocabulary(input.state) ?? states[0] : 'active'
            if (!states.includes(state)) return `Not saved: a ${kind} note is ${states.join(' or ')}`
            const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS)
            if (!text) return 'Not saved: text is empty'
            const list = await notes()
            const old = list.find((n) => sameSlot(n, { kind, subject: slot.subject }))
            if (old && old.state === state && old.text === text) return 'Already in your notes as it is; nothing changed.'
            if (!old && kind === 'other') {
                const others = list.filter((n) => n.kind === 'other')
                if (others.some((n) => n.text === text)) return 'Already in your notes as it is; nothing changed.'
                // Full: the new fact goes into the note it belongs with, or replaces one that's out of
                // date, so nothing is dropped and the user never has to clear notes
                if (others.length >= MAX_OTHER_NOTES) {
                    const lines = others.map((n) => `note ID: ${noteIdOf(n.subject!, list)} | ${n.text}`).join('\n')
                    return `Not saved: the ${MAX_OTHER_NOTES} other notes are full. Fold this fact into the note it belongs with, or replace one that is out of date: call remember again with that note_id and the whole new text. Say nothing about this to the user. The other notes:\n${lines}`
                }
            }
            if (!old && list.length >= MAX_NOTES) {
                // Only against abuse (the slots bound the count): the oldest note that isn't an active injury makes room
                const oldest = list.filter((n) => !isActiveInjury(n)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0]
                if (oldest && !(await data.deleteMemory(oldest))) list.splice(list.indexOf(oldest), 1)
            }
            const note: MemoryNote = { kind, subject: slot.subject, state, text, updatedAt: now().toISOString() }
            const error = await data.saveMemory(note)
            if (error) return `Not saved: ${error}`
            const at = list.findIndex((n) => sameSlot(n, note))
            if (at >= 0) list.splice(at, 1, note)
            else list.push(note)
            const line = memoryReceipt(old ? 'updated' : 'added', text, zh)
            remembered.push(line)
            const was = old ? `Updated (it was ${old.state}: "${old.text}")` : 'Saved'
            const label = kind === 'other' ? `other note ${noteIdOf(slot.subject!, list)}` : slot.label
            return `${was}: ${label}${kind === 'injury' || kind === 'exercise' ? `, ${state}` : ''}. The app shows the user "${line}" with your reply, so don't say it yourself.`
        },

        async forget(input) {
            if (!isMemoryKind(input.kind)) return 'Nothing forgotten: kind is injury, exercise, equipment or schedule'
            const kind = input.kind
            const slot = await slotOf(kind, input, false)
            if ('error' in slot) return `Nothing forgotten: ${slot.error}`
            const list = await notes()
            const old = list.find((n) => sameSlot(n, { kind, subject: slot.subject }))
            if (!old) return `There is no note for ${slot.label}; nothing was forgotten. Your notes are listed in the system prompt.`
            const error = await data.deleteMemory(old)
            if (error) return `Not forgotten: ${error}`
            list.splice(list.indexOf(old), 1)
            const line = memoryReceipt('forgotten', old.text, zh)
            remembered.push(line)
            return `Deleted the note on ${slot.label} ("${old.text}"). The app shows the user "${line}" with your reply, so don't say it yourself.`
        },
    }

    // Weekly totals (Monday to Sunday) computed here, so the model never does the arithmetic.
    // This week and last week are named, and this week says how far in it is: with dates
    // alone the model called last week's 21 chest sets "this week". Each exercise gets its
    // own sets and sessions, so bench press sets aren't read off the chest total.
    async function trainingSummary(dateFrom: string, dateTo: string): Promise<string> {
        const workouts = await workoutsBetween(dateFrom, dateTo)
        const sets = workouts.length ? await data.getSets(workouts.map((w) => w.id)) : []
        const trained = workouts.filter((w) => sets.some((s) => s.workout_id === w.id))
        if (!trained.length) return 'No workouts in this period'

        const byId = new Map((await exercises()).map((e) => [e.id, e]))
        const typeOf = (id: string): LogType => byId.get(id)?.log_type ?? 'weight_reps'
        const weeks = new Map<string, typeof trained>()
        for (const w of trained) {
            const monday = mondayOf(localDateStr(new Date(w.performed_at), timeZone))
            weeks.set(monday, [...(weeks.get(monday) ?? []), w])
        }

        // The better of two sets of one exercise: an assisted set with less assist, a timed set held
        // longer, a weighted set by estimated 1RM as the app's summary and the report pick it (by
        // weight alone, Ronnie called 100kg x 1 the best while History showed 90kg x 8), otherwise
        // more weight, then more reps
        const better = (type: LogType, a: WorkoutSet, b: WorkoutSet) => {
            if (fitsLogType(type, a) && fitsLogType(type, b)) {
                if (type === 'assisted') return (a.assistKg ?? 0) < (b.assistKg ?? 0) || ((a.assistKg ?? 0) === (b.assistKg ?? 0) && a.reps > b.reps)
                if (type === 'duration') return (a.durationS ?? 0) > (b.durationS ?? 0)
                if (type === 'weight_reps') return e1rm(a) > e1rm(b) || (e1rm(a) === e1rm(b) && a.reps > b.reps)
            }
            return a.weightKg > b.weightKg || (a.weightKg === b.weightKg && a.reps > b.reps)
        }

        const describe = (label: string, group: typeof trained) => {
            const groupSets = sets.filter((s) => group.some((w) => w.id === s.workout_id))
            // Cardio is time and distance, not sets of a muscle group; a cardio set logged before
            // log types (reps x weight only) stays with the rest
            const isCardioSet = (s: WorkoutSet) => isCardio(typeOf(s.exercise_id)) && fitsLogType(typeOf(s.exercise_id), s)
            const cardio = groupSets.filter(isCardioSet)
            const strength = groupSets.filter((s) => !isCardioSet(s))
            const volume = strength.reduce((sum, s) => sum + s.reps * s.weightKg, 0)
            const muscles = new Map<string, { sets: number; sessions: Set<string> }>()
            const perExercise = new Map<string, { sets: number; sessions: Set<string>; best: WorkoutSet }>()
            for (const st of strength) {
                const muscle = byId.get(st.exercise_id)?.muscle_group ?? 'other'
                const m = muscles.get(muscle) ?? { sets: 0, sessions: new Set<string>() }
                m.sets++
                m.sessions.add(st.workout_id)
                muscles.set(muscle, m)
                const e = perExercise.get(st.exercise_id) ?? { sets: 0, sessions: new Set<string>(), best: st }
                e.sets++
                e.sessions.add(st.workout_id)
                if (better(typeOf(st.exercise_id), st, e.best)) e.best = st
                perExercise.set(st.exercise_id, e)
            }
            const lines = [
                `${label}: ${group.length} sessions, ${strength.length} sets, volume ${Math.round(toDisplayWeight(volume, weightUnit)).toLocaleString('en-US')} ${weightUnit}`,
                ...(muscles.size ? [`  By muscle group: ${[...muscles].map(([m, v]) => `${m} ${v.sets} sets (${v.sessions.size} sessions)`).join(', ')}`] : []),
                ...(perExercise.size ? [`  By exercise: ${[...perExercise].map(([id, v]) => `${nameOf(byId.get(id))} ${v.sets} sets (${v.sessions.size} sessions), best ${setText(typeOf(id), v.best)}`).join('; ')}`] : []),
            ]
            if (cardio.length) {
                const minutesOf = (list: WorkoutSet[]) => Math.round(list.reduce((sum, s) => sum + (s.durationS ?? 0), 0) / 60)
                const perCardio = [...new Set(cardio.map((s) => s.exercise_id))].map((id) => {
                    const own = cardio.filter((s) => s.exercise_id === id)
                    const type = typeOf(id)
                    const distance = type === 'treadmill'
                        ? `, ${toDisplayDistance(own.reduce((sum, s) => sum + ((s.speedKmh ?? 0) * (s.durationS ?? 0)) / 3600, 0), distanceUnit)} ${distanceUnit}`
                        : type === 'rower' ? `, ${own.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)} m` : ''
                    return `${nameOf(byId.get(id))} ${minutesOf(own)} min${distance} (${new Set(own.map((s) => s.workout_id)).size} sessions)`
                })
                lines.push(`  Cardio: ${minutesOf(cardio)} min: ${perCardio.join('; ')}`)
            }
            return lines.join('\n')
        }

        const today = localDateStr(now(), timeZone)
        const thisMonday = mondayOf(today)
        const sections = [...weeks.keys()].sort().map((monday) => {
            // Clipped to the requested range, so a partial week says so
            const sunday = shiftDate(monday, 6)
            const dates = `${monday < dateFrom ? dateFrom : monday} to ${sunday > dateTo ? dateTo : sunday}`
            // This week up to today is "so far"; a range that stops before today is a partial week,
            // not "so far, today's sets included" (Monday and Tuesday read as the week's total)
            const soFar = monday === thisMonday && dateTo >= today
            const clipped = monday < dateFrom || (!soFar && sunday > dateTo)
            const day = (Date.parse(today) - Date.parse(monday)) / 86_400_000 + 1
            // "today's sets included": told only "so far", the model guessed today's sets were missing
            const name = soFar ? `This week so far, day ${day} of 7, today's sets included`
                : monday === thisMonday ? 'This week'
                : monday === shiftDate(thisMonday, -7) ? 'Last week'
                : 'Week'
            return describe(`${name}${clipped ? ', partial' : ''} (${dates})`, weeks.get(monday)!)
        })
        if (weeks.size > 1) sections.push(describe(`Total ${dateFrom} to ${dateTo}`, trained))
        if (sets.some((s) => s.weightKg === 0 && !isCardio(typeOf(s.exercise_id)))) sections.push('(Bodyweight sets add nothing to volume)')
        return sections.join('\n\n')
    }

    return {
        async executeTool(toolName, rawInput) {
            const tool = tools[toolName]
            if (!tool) return `Unknown tool ${toolName}`
            const input = { ...rawInput }
            for (const key of ['exercise_id', 'replaces_exercise_id']) if (input[key]) input[key] = await resolveId(String(input[key]))
            return tool(input)
        },
        get needsDashboardReload() {
            return needsDashboardReload
        },
        proposals,
        recommendations,
        plans,
        confirmations,
        notices,
        remembered,
        async todayLog() {
            const range = todayRange()
            const workout = await data.getLatestWorkoutBetween(range.start, range.end)
            if (!workout) return []
            const sets = await data.getSets([workout.id])
            return (await workoutExercises(workout.workout_planned_exercises ?? [], sets)).map((pe) => ({
                // The user's language first: the first name is the one said back
                names: namesOf(zh ? [pe.exercises?.name_zh_tw, pe.exercises?.name] : [pe.exercises?.name, pe.exercises?.name_zh_tw]),
                done: sets.some((s) => s.exercise_id === pe.exercise_id),
            }))
        },
    }
}
