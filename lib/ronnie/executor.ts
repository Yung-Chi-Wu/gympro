import type { RonnieData, RoutineProposal } from './data'
import { searchLibrary } from './search'
import { localDateStr, localDateToUtcRange } from './time'

// Ronnie's tool implementations. All reads and writes go through RonnieData.
// Results carry exercise IDs wherever an exercise is listed, so the model never
// has to guess one, and numbers (totals, counts) are computed here, not by the model.

const MUSCLE_ZH: Record<string, string> = {
    chest: '胸', back: '背', shoulders: '肩', biceps: '二頭', triceps: '三頭', legs: '腿', glutes: '臀', core: '核心',
}

export interface RonnieExecutorContext {
    data: RonnieData
    language: string
    timeZone: string
    todayRoutineName: string | null
    now?: () => Date
}

export interface RonnieExecutor {
    executeTool(toolName: string, toolInput: Record<string, string>): Promise<string>
    /** True once a tool changed today's workout or a routine, so the dashboard should reload. */
    readonly needsDashboardReload: boolean
    /** Routine changes proposed this turn, for the app to show Confirm buttons. */
    readonly proposals: (RoutineProposal & { id: string })[]
    /** Exercises recommended this turn, for the app to show as cards with an Add button. */
    readonly recommendations: { exerciseId: string; exerciseName: string }[]
}

// Exercise IDs are UUIDs, and the eval caught the model mis-copying one. Tool
// results show the first 8 characters instead, and inputs are resolved back to
// the full ID (a full UUID still works). A prefix shared by two exercises is shown in full.
const SHORT_ID_LENGTH = 8

export function createRonnieExecutor({
    data,
    language,
    timeZone,
    todayRoutineName,
    now = () => new Date(),
}: RonnieExecutorContext): RonnieExecutor {
    // 簡單 flag 追蹤是否需要 reload
    let needsDashboardReload = false
    const proposals: (RoutineProposal & { id: string })[] = []
    const recommendations: { exerciseId: string; exerciseName: string }[] = []
    const zh = language === 'zh-TW'
    const nameOf = (ex: { name: string; name_zh_tw: string | null } | null | undefined) =>
        (zh && ex?.name_zh_tw ? ex.name_zh_tw : ex?.name) ?? 'Unknown'

    let libraryIds: string[] | null = null
    async function allIds(): Promise<string[]> {
        libraryIds ??= (await data.listExercises()).map((e) => e.id)
        return libraryIds
    }
    async function shortId(id: string): Promise<string> {
        const prefix = id.slice(0, SHORT_ID_LENGTH)
        return (await allIds()).filter((x) => x.startsWith(prefix)).length > 1 ? id : prefix
    }
    /** A full UUID, or the short form shown in tool results, back to the full ID. */
    async function resolveId(raw: string | undefined): Promise<string> {
        const value = String(raw ?? '').trim().toLowerCase()
        const ids = await allIds()
        if (ids.includes(value)) return value
        const prefix = value.slice(0, SHORT_ID_LENGTH)
        const matches = prefix.length === SHORT_ID_LENGTH ? ids.filter((x) => x.startsWith(prefix)) : []
        return matches.length === 1 ? matches[0] : value
    }

    async function executeTool(toolName: string, rawInput: Record<string, string>): Promise<string> {
        const toolInput = rawInput.exercise_id ? { ...rawInput, exercise_id: await resolveId(rawInput.exercise_id) } : rawInput

        if (toolName === 'get_routine_exercises') {
            const routines = await data.findRoutinesByName(toolInput.routine_name)

            if (!routines?.length) {
                return language === 'zh-TW'
                    ? `找不到叫「${toolInput.routine_name}」的課表`
                    : `No routine found named "${toolInput.routine_name}"`
            }

            const routine = routines[0]
            const exercises = await data.getRoutineExercises(routine.id)

            if (!exercises?.length) {
                return language === 'zh-TW'
                    ? `「${routine.name}」裡面沒有動作`
                    : `"${routine.name}" has no exercises`
            }

            const list = (await Promise.all(exercises.map(async (ex) =>
                `ID: ${await shortId(ex.exercise_id)} | ${nameOf(ex.exercises)}: ${ex.target_sets ?? '?'}組 × ${ex.target_reps ?? '?'}下`
            ))).join('\n')

            return zh
                ? `「${routine.name}」的動作：\n${list}`
                : `"${routine.name}" exercises:\n${list}`
        }

        if (toolName === 'propose_routine_change') {
            // Permanent: only proposed here. The app executes it after the user taps Confirm.
            const exercise = (await data.listExercises()).find((e) => e.id === toolInput.exercise_id)
            if (!exercise) {
                return zh ? '這個動作 ID 不存在，請先用 search_exercises 查詢' : 'Unknown exercise ID - look it up with search_exercises first'
            }
            let routines = await data.findRoutinesWithExercise(exercise.id)
            if (toolInput.routine_name) {
                const wanted = toolInput.routine_name.toLowerCase()
                routines = routines.filter((r) => r.name.toLowerCase().includes(wanted))
            }
            const exerciseName = nameOf(exercise)
            if (!routines.length) {
                const where = toolInput.routine_name ? `「${toolInput.routine_name}」` : (zh ? '任何固定課表' : 'any routine')
                return zh ? `「${exerciseName}」不在${where}裡，不需要修改` : `"${exerciseName}" is not in ${where}; nothing to change`
            }
            const proposal: RoutineProposal = {
                change: 'remove_exercise',
                exerciseId: exercise.id,
                exerciseName,
                routineIds: routines.map((r) => r.id),
                routineNames: routines.map((r) => r.name),
            }
            const saved = await data.createProposal(proposal)
            if ('error' in saved) return zh ? `提議建立失敗：${saved.error}` : `Failed to create the proposal: ${saved.error}`
            proposals.push({ ...proposal, id: saved.id })
            const names = proposal.routineNames.map((n) => `「${n}」`).join(zh ? '、' : ', ')
            // The model echoes tool results, so hand it the wording - and only that: it kept
            // opening with "Done!", and naming the words to avoid made it say them (搞定)
            return zh
                ? `已建立提議（尚未生效）：從${names}移除「${exerciseName}」。這樣回覆使用者：已準備好，在 app 裡按「確認」後生效。`
                : `Proposal created, not applied yet: remove "${exerciseName}" from ${names}. Reply to the user: Ready - tap Confirm in the app to apply.`
        }

        if (toolName === 'search_exercises') {
            const { exercises: results, exact } = searchLibrary(await data.listExercises(), toolInput.query, toolInput.muscle_group)
            if (!results.length) {
                return zh
                    ? '找不到符合的動作。可以換個說法再查（英文或中文、較短的關鍵字，或用 muscle_group）'
                    : 'No exercises found. Try other wording (English or Chinese, a shorter keyword, or a muscle_group)'
            }
            const lines = (await Promise.all(results.map(async (ex) => `ID: ${await shortId(ex.id)} | ${nameOf(ex)} (${ex.muscle_group})`))).join('\n')
            if (exact) return lines
            return zh
                ? `動作庫裡沒有完全符合「${toolInput.query}」的動作，以下是最接近的：\n${lines}`
                : `No exercise in the library matches "${toolInput.query}" exactly. Closest matches:\n${lines}`
        }

        if (toolName === 'get_workout_history') {
            const fromRange = localDateToUtcRange(toolInput.date_from, timeZone)
            const toRange = localDateToUtcRange(toolInput.date_to, timeZone)

            const workouts = await data.getWorkoutsBetween(fromRange.start, toRange.end)

            if (!workouts?.length) return language === 'zh-TW' ? '這段期間沒有訓練記錄' : 'No workouts found'

            const allSets = await data.getSets(workouts.map((w) => w.id))

            return workouts.map((w) => {
                const date = new Date(w.performed_at).toLocaleDateString(
                    language === 'zh-TW' ? 'zh-TW' : 'en-US',
                    { timeZone, month: 'long', day: 'numeric', weekday: 'short' }
                )
                const exercises = (w.workout_planned_exercises ?? []).map((pe) => {
                    const exName = language === 'zh-TW' && pe.exercises?.name_zh_tw
                        ? pe.exercises.name_zh_tw : pe.exercises?.name ?? 'Unknown'
                    const sets = (allSets ?? [])
                        .filter((s) => s.workout_id === w.id && s.exercise_id === pe.exercise_id)
                        .map((s) => `${s.reps}×${s.weight_kg}kg`).join(', ')
                    return `  ${exName}: ${sets || '(no sets logged)'}`
                }).join('\n')
                return `${date}:\n${exercises}`
            }).join('\n\n')
        }

        if (toolName === 'get_today_workout') {
            const todayStr = localDateStr(now(), timeZone)
            const range = localDateToUtcRange(todayStr, timeZone)

            const workout = await data.getLatestWorkoutBetween(range.start, range.end)

            if (workout) {
                const todaySets = await data.getSets([workout.id])

                const exercises = (await Promise.all((workout.workout_planned_exercises ?? []).map(async (pe) => {
                    const sets = (todaySets ?? [])
                        .filter((s) => s.exercise_id === pe.exercise_id)
                        .map((s) => `${s.reps}×${s.weight_kg}kg`).join(', ')
                    return `ID: ${await shortId(pe.exercise_id)} | ${nameOf(pe.exercises)}: ${sets || (zh ? '尚未記錄' : 'no sets yet')}`
                }))).join('\n')
                return exercises || (language === 'zh-TW' ? '今天課表是空的' : 'No exercises today')
            }

            // 尚未開始，從 routine 顯示計畫
            const routineId = await data.getTodayRoutineId()
            if (routineId) {
                const routineExercises = await data.getRoutinePlan(routineId)

                if (routineExercises?.length) {
                    const list = (await Promise.all(routineExercises.map(async (re) =>
                        `ID: ${await shortId(re.exercise_id)} | ${nameOf(re.exercises)}: ${re.target_sets ?? '?'}組 × ${re.target_reps ?? '?'}下（計畫）`
                    ))).join('\n')
                    return zh
                        ? `今天課表「${todayRoutineName}」（尚未開始記錄）：\n${list}`
                        : `Today's routine "${todayRoutineName}" (not started):\n${list}`
                }
            }

            return language === 'zh-TW' ? '今天是休息日或沒有課表' : 'Rest day or no routine today'
        }

        if (toolName === 'add_exercise_today') {
            const workoutId = await data.ensureTodayWorkout()
            if (!workoutId) return language === 'zh-TW' ? '建立今日訓練失敗' : 'Failed to create workout'

            const error = await data.addPlannedExercise(workoutId, toolInput.exercise_id)

            if (error) return language === 'zh-TW' ? `新增失敗：${error}` : `Failed: ${error}`
            needsDashboardReload = true
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」加入今天的課表`
                : `✓ Added "${toolInput.exercise_name}" to today's workout`
        }

        if (toolName === 'remove_exercise_today') {
            const workoutId = await data.ensureTodayWorkout()
            if (!workoutId) return language === 'zh-TW' ? '建立今日訓練失敗' : 'Failed to create workout'

            const { error, removed } = await data.removePlannedExercise(workoutId, toolInput.exercise_id)

            if (error) return language === 'zh-TW' ? `移除失敗：${error}` : `Failed: ${error}`
            // Deleting by an unknown id removes nothing - report that instead of a false success
            if (!removed) {
                return zh
                    ? '今天的課表裡沒有這個動作 ID，沒有移除任何東西。請用 get_today_workout 取得正確的 ID'
                    : "That exercise ID is not in today's workout, so nothing was removed. Get the right ID from get_today_workout"
            }
            needsDashboardReload = true
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」從今天課表移除（不影響固定課表）`
                : `✓ Removed "${toolInput.exercise_name}" from today only (routine unchanged)`
        }

        if (toolName === 'recommend_exercise') {
            const exercise = (await data.listExercises()).find((e) => e.id === toolInput.exercise_id)
            if (!exercise) {
                return zh ? '這個動作 ID 不存在，請先用 search_exercises 查詢' : 'Unknown exercise ID - look it up with search_exercises first'
            }
            recommendations.push({ exerciseId: exercise.id, exerciseName: nameOf(exercise) })
            return zh
                ? `已顯示推薦卡片：「${nameOf(exercise)}」，使用者可以直接按「加入今天」，也可以叫你加入。`
                : `Showing a recommendation card for "${nameOf(exercise)}"; the user can tap Add to today or ask you to add it.`
        }

        if (toolName === 'get_training_summary') {
            return trainingSummary(toolInput.date_from, toolInput.date_to)
        }

        return 'Tool not found'
    }

    // Weekly totals (Monday to Sunday) computed here, so the model never does the arithmetic
    async function trainingSummary(dateFrom: string, dateTo: string): Promise<string> {
        const workouts = await data.getWorkoutsBetween(
            localDateToUtcRange(dateFrom, timeZone).start,
            localDateToUtcRange(dateTo, timeZone).end
        )
        const sets = workouts.length ? await data.getSets(workouts.map((w) => w.id)) : []
        const trained = workouts.filter((w) => sets.some((s) => s.workout_id === w.id))
        if (!trained.length) return zh ? '這段期間沒有訓練記錄' : 'No workouts found'

        const library = new Map((await data.listExercises()).map((e) => [e.id, e]))
        const mondayOf = (iso: string) => {
            const d = new Date(`${iso}T00:00:00Z`)
            d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
            return d.toISOString().slice(0, 10)
        }
        const addDays = (iso: string, n: number) => {
            const d = new Date(`${iso}T00:00:00Z`)
            d.setUTCDate(d.getUTCDate() + n)
            return d.toISOString().slice(0, 10)
        }
        const weeks = new Map<string, typeof trained>()
        for (const w of trained) {
            const key = mondayOf(localDateStr(new Date(w.performed_at), timeZone))
            weeks.set(key, [...(weeks.get(key) ?? []), w])
        }

        let bodyweightSets = false
        const describe = (label: string, group: typeof trained) => {
            const groupSets = sets.filter((s) => group.some((w) => w.id === s.workout_id))
            const volume = groupSets.reduce((sum, s) => sum + s.reps * s.weight_kg, 0)
            if (groupSets.some((s) => s.weight_kg === 0)) bodyweightSets = true
            const muscles = new Map<string, { sets: number; sessions: Set<string> }>()
            const best = new Map<string, { reps: number; weight_kg: number }>()
            for (const st of groupSets) {
                const muscle = library.get(st.exercise_id)?.muscle_group ?? 'other'
                const m = muscles.get(muscle) ?? { sets: 0, sessions: new Set<string>() }
                m.sets++
                m.sessions.add(st.workout_id)
                muscles.set(muscle, m)
                const b = best.get(st.exercise_id)
                if (!b || st.weight_kg > b.weight_kg || (st.weight_kg === b.weight_kg && st.reps > b.reps)) best.set(st.exercise_id, st)
            }
            const muscleText = [...muscles].map(([m, v]) => zh
                ? `${MUSCLE_ZH[m] ?? m} ${v.sets} 組（${v.sessions.size} 次）`
                : `${m} ${v.sets} sets (${v.sessions.size} sessions)`).join(zh ? '、' : ', ')
            const bestText = [...best].map(([id, b]) => `${nameOf(library.get(id))} ${b.weight_kg}kg × ${b.reps}`).join(zh ? '、' : ', ')
            const kg = Math.round(volume).toLocaleString('en-US')
            return zh
                ? `${label}：訓練 ${group.length} 次，共 ${groupSets.length} 組，總訓練量 ${kg} kg\n  各肌群：${muscleText}\n  最佳組：${bestText}`
                : `${label}: ${group.length} sessions, ${groupSets.length} sets, volume ${kg} kg\n  By muscle group: ${muscleText}\n  Best sets: ${bestText}`
        }

        const sections = [...weeks.keys()].sort().map((monday) => {
            // Clip the week to the requested range, so a partial week says so
            const from = monday < dateFrom ? dateFrom : monday
            const sunday = addDays(monday, 6)
            const to = sunday > dateTo ? dateTo : sunday
            return describe(zh ? `${from} ～ ${to}` : `${from} to ${to}`, weeks.get(monday)!)
        })
        if (weeks.size > 1) sections.push(describe(zh ? `合計 ${dateFrom} ～ ${dateTo}` : `Total ${dateFrom} to ${dateTo}`, trained))
        if (bodyweightSets) sections.push(zh ? '（徒手動作重量記為 0，不計入訓練量）' : '(Bodyweight sets are logged at 0 kg and add nothing to volume)')
        return sections.join('\n\n')
    }

    return {
        executeTool,
        get needsDashboardReload() {
            return needsDashboardReload
        },
        get proposals() {
            return proposals
        },
        get recommendations() {
            return recommendations
        },
    }
}
