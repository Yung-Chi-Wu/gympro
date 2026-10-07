import type { RonnieData } from './data'
import { localDateStr, localDateToUtcRange } from './time'

// Ronnie's tool implementations, moved from app/api/ai/coach/route.ts. All
// reads and writes go through RonnieData; the text returned to the model is
// unchanged.

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
}

export function createRonnieExecutor({
    data,
    language,
    timeZone,
    todayRoutineName,
    now = () => new Date(),
}: RonnieExecutorContext): RonnieExecutor {
    // 簡單 flag 追蹤是否需要 reload
    let needsDashboardReload = false

    async function executeTool(toolName: string, toolInput: Record<string, string>): Promise<string> {

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

            const zh = language === 'zh-TW'
            const list = exercises.map((ex) => {
                const name = zh && ex.exercises?.name_zh_tw
                    ? ex.exercises.name_zh_tw : ex.exercises?.name ?? 'Unknown'
                return `${name}: ${ex.target_sets ?? '?'}組 × ${ex.target_reps ?? '?'}下`
            }).join('\n')

            return zh
                ? `「${routine.name}」的動作：\n${list}`
                : `"${routine.name}" exercises:\n${list}`
        }

        if (toolName === 'search_exercises') {
            const results = await data.searchExercises(toolInput.query, toolInput.muscle_group)
            if (!results?.length) return language === 'zh-TW' ? '找不到符合的動作' : 'No exercises found'
            return results.map((ex) => {
                const name = language === 'zh-TW' && ex.name_zh_tw ? ex.name_zh_tw : ex.name
                return `ID: ${ex.id} | ${name} (${ex.muscle_group})`
            }).join('\n')
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

                const exercises = (workout.workout_planned_exercises ?? []).map((pe) => {
                    const exName = language === 'zh-TW' && pe.exercises?.name_zh_tw
                        ? pe.exercises.name_zh_tw : pe.exercises?.name ?? 'Unknown'
                    const sets = (todaySets ?? [])
                        .filter((s) => s.exercise_id === pe.exercise_id)
                        .map((s) => `${s.reps}×${s.weight_kg}kg`).join(', ')
                    return `${exName}: ${sets || (language === 'zh-TW' ? '尚未記錄' : 'no sets yet')}`
                }).join('\n')
                return exercises || (language === 'zh-TW' ? '今天課表是空的' : 'No exercises today')
            }

            // 尚未開始，從 routine 顯示計畫
            const routineId = await data.getTodayRoutineId()
            if (routineId) {
                const routineExercises = await data.getRoutinePlan(routineId)

                if (routineExercises?.length) {
                    const zh = language === 'zh-TW'
                    const list = routineExercises.map((re) => {
                        const exName = zh && re.exercises?.name_zh_tw
                            ? re.exercises.name_zh_tw : re.exercises?.name ?? 'Unknown'
                        return `${exName}: ${re.target_sets ?? '?'}組 × ${re.target_reps ?? '?'}下（計畫）`
                    }).join('\n')
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
            console.log('remove_exercise_today called with:', toolInput)
            const workoutId = await data.ensureTodayWorkout()
            console.log('workoutId:', workoutId)
            if (!workoutId) return language === 'zh-TW' ? '建立今日訓練失敗' : 'Failed to create workout'

            const error = await data.removePlannedExercise(workoutId, toolInput.exercise_id)

            if (error) return language === 'zh-TW' ? `移除失敗：${error}` : `Failed: ${error}`
            needsDashboardReload = true
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」從今天課表移除（不影響固定課表）`
                : `✓ Removed "${toolInput.exercise_name}" from today only (routine unchanged)`
        }

        return 'Tool not found'
    }

    return {
        executeTool,
        get needsDashboardReload() {
            return needsDashboardReload
        },
    }
}
