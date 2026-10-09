import type { LibraryExercise, RonnieData, RoutineProposal } from './data'
import { describeProposal } from './events'
import { gatedSearch, latinTokens, searchLibrary } from './search'
import { localDateStr, localDateToUtcRange } from './time'

// Ronnie's tools. Results are for the model, so they are in English whatever the
// user's language; exercise names follow the user's language (Ronnie quotes them),
// and the lines the user sees (confirmations) are localized. Exercises are listed
// with IDs so the model never guesses one, and numbers are computed here.

export interface RonnieExecutorContext {
    data: RonnieData
    language: string
    timeZone: string
    todayRoutineName: string | null
    now?: () => Date
}

export interface RonnieExecutor {
    executeTool(toolName: string, toolInput: Record<string, string>): Promise<string>
    /** True once a tool changed today's workout, so the dashboard should reload. */
    readonly needsDashboardReload: boolean
    /** Routine changes proposed this turn, shown as cards to confirm. */
    readonly proposals: (RoutineProposal & { id: string })[]
    /** Exercises recommended this turn, shown as cards with an Add to today button. */
    readonly recommendations: { exerciseId: string; exerciseName: string }[]
    /** What this turn changed or proposed, in the user's language: the reply when the model's can't be used. */
    readonly confirmations: string[]
}

// Results show the first 8 characters of an exercise ID (the model mis-copied full UUIDs);
// inputs are resolved back. A prefix two exercises share is shown in full.
const SHORT_ID_LENGTH = 8
// More removals than this in one turn is a redesign, not a tweak
export const MAX_REMOVALS_PER_TURN = 3
const UNKNOWN_ID = 'Unknown exercise ID - look it up with search_exercises first'

/** A whole number from 1 to 100 (the model may send it as a string), else the default. */
function positiveInt(value: unknown, fallback: number): number {
    const n = Number(value)
    return Number.isInteger(n) && n >= 1 && n <= 100 ? n : fallback
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

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const shiftDate = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
}
const mondayOf = (iso: string) => shiftDate(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7))

export function createRonnieExecutor({ data, language, timeZone, todayRoutineName, now = () => new Date() }: RonnieExecutorContext): RonnieExecutor {
    const zh = language === 'zh-TW'
    let needsDashboardReload = false
    let removalAttempts = 0
    const proposals: (RoutineProposal & { id: string })[] = []
    const recommendations: { exerciseId: string; exerciseName: string }[] = []
    const confirmations: string[] = []

    const nameOf = (ex: { name: string; name_zh_tw: string | null } | null | undefined) =>
        (zh && ex?.name_zh_tw ? ex.name_zh_tw : ex?.name) ?? 'Unknown'
    // A bodyweight set is logged at 0 kg; said outright, since the model read 8×0kg as an assisted machine
    const setText = (s: { reps: number; weight_kg: number }) => (s.weight_kg === 0 ? `${s.reps} reps (bodyweight)` : `${s.reps}×${s.weight_kg}kg`)
    const targets = (r: { target_sets: number | null; target_reps: number | null }) => `${r.target_sets ?? '?'} sets x ${r.target_reps ?? '?'} reps`
    /** A change to today's workout, worded for the user: also the tool's result. */
    const changed = (zhLine: string, enLine: string) => {
        needsDashboardReload = true
        const line = zh ? zhLine : enLine
        confirmations.push(line)
        return line
    }
    const todayRange = () => localDateToUtcRange(localDateStr(now(), timeZone), timeZone)
    const workoutsBetween = (from: string, to: string) =>
        data.getWorkoutsBetween(localDateToUtcRange(from, timeZone).start, localDateToUtcRange(to, timeZone).end)

    let library: LibraryExercise[] | null = null
    const exercises = async () => (library ??= await data.listExercises())
    const findExercise = async (id: string) => (await exercises()).find((e) => e.id === id)
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

    const tools: Record<string, (input: Record<string, string>) => Promise<string>> = {
        async get_routine_exercises(input) {
            const [routine] = await data.findRoutinesByName(input.routine_name)
            if (!routine) return `No routine named "${input.routine_name}"`
            const rows = await data.getRoutineExercises(routine.id)
            if (!rows.length) return `"${routine.name}" has no exercises`
            const lines = await Promise.all(rows.map((r) => listLine(r.exercise_id, nameOf(r.exercises), targets(r))))
            return `"${routine.name}":\n${lines.join('\n')}`
        },

        async search_exercises(input) {
            const library = await exercises()
            const query = input.query?.trim()
            const nearest = query ? await data.nearestExercises(query, input.muscle_group) : null
            const { exercises: found, exact } = gatedSearch(library, searchLibrary(library, query, input.muscle_group, 20), nearest)
            if (!found.length) return 'No exercises found. Try other wording (English or Chinese, a shorter keyword, or a muscle_group).'
            const lines = (await Promise.all(found.map((e) => listLine(e.id, `${nameOf(e)} (${e.muscle_group})`)))).join('\n')
            return exact ? lines : `Nothing in the library matches "${input.query}" exactly. Closest:\n${lines}`
        },

        async get_workout_history(input) {
            const workouts = await workoutsBetween(input.date_from, input.date_to)
            if (!workouts.length) return 'No workouts in this period'
            const sets = await data.getSets(workouts.map((w) => w.id))
            return workouts.map((w) => {
                const date = localDateStr(new Date(w.performed_at), timeZone)
                const lines = (w.workout_planned_exercises ?? []).map((pe) => {
                    const done = sets.filter((s) => s.workout_id === w.id && s.exercise_id === pe.exercise_id).map(setText).join(', ')
                    return `  ${nameOf(pe.exercises)}: ${done || 'no sets logged'}`
                })
                return `${date} (${weekdayOf(date)}):\n${lines.join('\n')}`
            }).join('\n\n')
        },

        async get_today_workout() {
            const range = todayRange()
            const workout = await data.getLatestWorkoutBetween(range.start, range.end)
            if (workout) {
                const sets = await data.getSets([workout.id])
                const lines = await Promise.all((workout.workout_planned_exercises ?? []).map((pe) =>
                    listLine(pe.exercise_id, nameOf(pe.exercises), sets.filter((s) => s.exercise_id === pe.exercise_id).map(setText).join(', ') || 'no sets yet')))
                return lines.join('\n') || 'Nothing planned today'
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
            const workoutId = await data.ensureTodayWorkout()
            if (!workoutId) return "Could not create today's workout"
            const error = await data.addPlannedExercise(workoutId, exercise.id)
            if (error) return `Not added: ${error}`
            return changed(`✓ 已將「${nameOf(exercise)}」加入今天的課表`, `✓ Added "${nameOf(exercise)}" to today's workout`)
        },

        async remove_exercise_today(input) {
            const workoutId = await data.ensureTodayWorkout()
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
            const { error, removed } = await data.removePlannedExercise(workoutId, id)
            if (error) return `Not removed: ${error}`
            // An unknown ID removes nothing: say so instead of a false success
            if (!removed) return "That exercise isn't in today's workout; nothing was removed. Get the ID from get_today_workout."
            return changed(`✓ 已將「${name}」從今天課表移除（不影響固定課表）`, `✓ Removed "${name}" from today only (routines unchanged)`)
        },

        async recommend_exercise(input) {
            const exercise = await findExercise(input.exercise_id)
            if (!exercise) return UNKNOWN_ID
            recommendations.push({ exerciseId: exercise.id, exerciseName: nameOf(exercise) })
            return `Showing a card for "${nameOf(exercise)}" with an Add to today button.`
        },

        get_training_summary: (input) => trainingSummary(input.date_from, input.date_to),

        async propose_routine_change(input) {
            // Only proposed: the change happens when the user confirms it in the app. The cap is
            // counted before any await, so parallel calls in one response can't all slip under it.
            const add = input.change === 'add'
            if (!add && removalAttempts++ >= MAX_REMOVALS_PER_TURN) {
                return `At most ${MAX_REMOVALS_PER_TURN} removals at once; this one was not proposed. For a bigger change, suggest a redesign with Coach G.`
            }
            const exercise = await findExercise(input.exercise_id)
            if (!exercise) return UNKNOWN_ID
            const exerciseName = nameOf(exercise)
            const containing = await data.findRoutinesWithExercise(exercise.id)
            let proposal: RoutineProposal
            if (add) {
                if (!input.routine_name) return 'Adding needs routine_name: the routine to add it to'
                const found = await data.findRoutinesByName(input.routine_name)
                const routine = found.find((r) => r.name.toLowerCase() === input.routine_name.toLowerCase()) ?? (found.length === 1 ? found[0] : null)
                if (!routine) {
                    return found.length
                        ? `Several routines match "${input.routine_name}": ${found.map((r) => r.name).join(', ')}; pick one`
                        : `No routine named "${input.routine_name}"`
                }
                if (containing.some((r) => r.id === routine.id)) return `"${exerciseName}" is already in "${routine.name}"; nothing to add`
                proposal = {
                    change: 'add_exercise',
                    exerciseId: exercise.id,
                    exerciseName,
                    routineIds: [routine.id],
                    routineNames: [routine.name],
                    targetSets: positiveInt(input.target_sets, 3),
                    targetReps: positiveInt(input.target_reps, 10),
                }
            } else {
                const wanted = input.routine_name?.toLowerCase()
                const routines = wanted ? containing.filter((r) => r.name.toLowerCase().includes(wanted)) : containing
                if (!routines.length) return `"${exerciseName}" is not in ${wanted ? `"${input.routine_name}"` : 'any routine'}; nothing to change`
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
        const weeks = new Map<string, typeof trained>()
        for (const w of trained) {
            const monday = mondayOf(localDateStr(new Date(w.performed_at), timeZone))
            weeks.set(monday, [...(weeks.get(monday) ?? []), w])
        }

        const describe = (label: string, group: typeof trained) => {
            const groupSets = sets.filter((s) => group.some((w) => w.id === s.workout_id))
            const volume = groupSets.reduce((sum, s) => sum + s.reps * s.weight_kg, 0)
            const muscles = new Map<string, { sets: number; sessions: Set<string> }>()
            const perExercise = new Map<string, { sets: number; sessions: Set<string>; best: { reps: number; weight_kg: number } }>()
            for (const st of groupSets) {
                const muscle = byId.get(st.exercise_id)?.muscle_group ?? 'other'
                const m = muscles.get(muscle) ?? { sets: 0, sessions: new Set<string>() }
                m.sets++
                m.sessions.add(st.workout_id)
                muscles.set(muscle, m)
                const e = perExercise.get(st.exercise_id) ?? { sets: 0, sessions: new Set<string>(), best: st }
                e.sets++
                e.sessions.add(st.workout_id)
                if (st.weight_kg > e.best.weight_kg || (st.weight_kg === e.best.weight_kg && st.reps > e.best.reps)) e.best = st
                perExercise.set(st.exercise_id, e)
            }
            return [
                `${label}: ${group.length} sessions, ${groupSets.length} sets, volume ${Math.round(volume).toLocaleString('en-US')} kg`,
                `  By muscle group: ${[...muscles].map(([m, v]) => `${m} ${v.sets} sets (${v.sessions.size} sessions)`).join(', ')}`,
                `  By exercise: ${[...perExercise].map(([id, v]) => `${nameOf(byId.get(id))} ${v.sets} sets (${v.sessions.size} sessions), best ${setText(v.best)}`).join('; ')}`,
            ].join('\n')
        }

        const today = localDateStr(now(), timeZone)
        const thisMonday = mondayOf(today)
        const sections = [...weeks.keys()].sort().map((monday) => {
            // Clipped to the requested range, so a partial week says so
            const sunday = shiftDate(monday, 6)
            const dates = `${monday < dateFrom ? dateFrom : monday} to ${sunday > dateTo ? dateTo : sunday}`
            const clipped = monday < dateFrom || (monday !== thisMonday && sunday > dateTo)
            const day = (Date.parse(today) - Date.parse(monday)) / 86_400_000 + 1
            const name = monday === thisMonday ? `This week so far, day ${day} of 7`
                : monday === shiftDate(thisMonday, -7) ? 'Last week'
                : 'Week'
            return describe(`${name}${clipped ? ', partial' : ''} (${dates})`, weeks.get(monday)!)
        })
        if (weeks.size > 1) sections.push(describe(`Total ${dateFrom} to ${dateTo}`, trained))
        if (sets.some((s) => s.weight_kg === 0)) sections.push('(Bodyweight sets add nothing to volume)')
        return sections.join('\n\n')
    }

    return {
        async executeTool(toolName, rawInput) {
            const tool = tools[toolName]
            if (!tool) return `Unknown tool ${toolName}`
            const input = rawInput.exercise_id ? { ...rawInput, exercise_id: await resolveId(String(rawInput.exercise_id)) } : rawInput
            return tool(input)
        },
        get needsDashboardReload() {
            return needsDashboardReload
        },
        proposals,
        recommendations,
        confirmations,
    }
}
