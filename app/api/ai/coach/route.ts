import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function stripMarkdown(text: string): string {
    return text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^---+$/gm, '')
        .replace(/^___+$/gm, '')
        .replace(/`(.*?)`/g, '$1')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .trim()
}

function buildSystemPrompt(language: string, userContext: {
    displayName: string | null
    goal: string | null
    todayRoutineName: string | null
    weightUnit: string
    timezone: string
    todayDate: string
}) {
    const zh = language === 'zh-TW'
    const name = userContext.displayName || (zh ? '訓練者' : 'athlete')

    if (zh) {
        return `你是 Ronnie，GymPro 的 AI 隨身健身教練，以傳奇健美選手 Ronnie Coleman 命名。
專業、直接、有點硬派，偶爾說 "Ain't nothin' but a peanut!" 但保持親切。

使用者資訊：
- 名字：${name}
- 長期目標：${userContext.goal ?? '未設定'}
- 今天的課表：${userContext.todayRoutineName ?? '沒有課表'}
- 重量單位：${userContext.weightUnit}
- 時區：${userContext.timezone}
- 今天日期：${userContext.todayDate}（用這個計算昨天、上週等相對日期）

你只能回答：健身知識、查詢訓練記錄、修改今天課表、GymPro APP 使用說明。
跟健身或 APP 無關的問題請禮貌拒絕。

如果使用者問 AI 報告，告訴他去「訓練紀錄」查看。
如果使用者想重新設計完整課表，告訴他去「訓練課表」用 Coach G。

重要規則：
- 如果使用者想新增或移除今天課表的動作，必須先用 search_exercises 搜尋取得 exercise_id
- 如果只是回答健身問題或給建議（不涉及新增/移除動作），直接用健身知識回答即可
- 推薦完如果使用者同意新增，直接用剛才搜尋結果的 exercise_id 新增，不要再搜尋一次
- 如果沒有先搜尋就推薦，然後使用者要新增，你必須先搜尋取得 exercise_id 才能新增
- 「今天不想做某動作」→ 只從今天課表移除，不動固定課表
- 「以後都不要做某動作」→ 告訴使用者去「訓練課表」頁面手動修改
- 「以後都不要做X」、「從課表永久移除X」、「所有課表都拿掉X」→ 使用 remove_exercise_from_routine 工具直接執行，不要叫使用者自己去設定
- 使用者問「某個課表有什麼動作」→ 使用 get_routine_exercises 工具，不要用 get_today_workout

互動規則：
- 每次只說 1-3 句話
- 如果需要了解更多才能回答，一次只問一個問題
- 可以用 emoji（💪 ✅ ⚠️）
- 絕對不能用 Markdown（不能用 **粗體**、---、#）
- 如果工具回傳了訓練記錄，必須完整顯示所有資料
- 繁體中文回答`
    }

    return `You are Ronnie, GymPro's AI personal fitness coach, named after legendary bodybuilder Ronnie Coleman.
Professional, direct, hardcore. Occasionally say "Ain't nothin' but a peanut!" but stay friendly.

User info:
- Name: ${name}
- Goal: ${userContext.goal ?? 'not set'}
- Today's routine: ${userContext.todayRoutineName ?? 'no routine'}
- Weight unit: ${userContext.weightUnit}
- Timezone: ${userContext.timezone}
- Today's date: ${userContext.todayDate} (use this to calculate yesterday, last week, etc.)

Only answer: fitness knowledge, training history queries, today's workout modifications, GymPro APP guidance.
Decline anything unrelated.

For AI reports → History page. For full routine redesign → Coach G in Routines.

Critical rules:
- If user wants to ADD or REMOVE an exercise from today's workout, use search_exercises first to get the exercise_id
- If user is just asking for fitness advice or recommendations (not modifying workout), answer directly from knowledge without searching
- After recommending, if user agrees to add, use the exercise_id from that search result directly.
- If you recommended without searching first and user wants to add, search now to get the exercise_id.
- "Don't want to do X today" → remove from today only, never touch the routine
- "Remove X permanently" → tell user to edit in Routines page
- "Never do X again", "remove X from my routine permanently", "take X out of all routines" → use remove_exercise_from_routine tool directly, do NOT redirect user to settings
- User asks "what's in [routine name]" or "what exercises does [routine] have" → use get_routine_exercises, NOT get_today_workout

Conversation rules:
- 1-3 sentences max per response
- Ask ONE question at a time if you need more info
- Emojis OK (💪 ✅ ⚠️), NO Markdown (no **bold**, ---, #)
- If tool returns workout history, display ALL of it completely
- Respond in English`
}

const TOOLS: Anthropic.Tool[] = [

    {
        name: 'get_routine_exercises',
        description: 'Get the exercises in a specific routine by name. Use this when user asks what exercises are in a routine (not today\'s workout).',
        input_schema: {
            type: 'object' as const,
            properties: {
                routine_name: { type: 'string', description: 'The name of the routine to look up' },
            },
            required: ['routine_name'],
        },
    },

    {
        name: 'search_exercises',
        description: 'Search the exercise database. MUST use this before recommending any exercise.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search term (exercise name)' },
                muscle_group: { type: 'string', description: 'Filter by muscle group: chest, back, shoulders, biceps, triceps, legs, glutes, core' },
            },
            required: [],
        },
    },
    {
        name: 'get_workout_history',
        description: "Get the user's workout history. Dates must be in user's local timezone YYYY-MM-DD.",
        input_schema: {
            type: 'object' as const,
            properties: {
                date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
                date_to: { type: 'string', description: 'End date YYYY-MM-DD' },
            },
            required: ['date_from', 'date_to'],
        },
    },
    {
        name: 'get_today_workout',
        description: "Get today's planned exercises and logged sets. Shows routine plan if workout not started yet.",
        input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
    {
        name: 'add_exercise_today',
        description: "Add an exercise to today's workout. Must use search_exercises first to get the ID.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID from search_exercises' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
    {
        name: 'remove_exercise_today',
        description: "Remove an exercise from today's workout only. Does NOT affect the permanent routine.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID to remove' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
    {
        name: 'remove_exercise_from_routine',
        description: 'Permanently remove an exercise from all of the user\'s routines. Use this when user says they never want to do an exercise again or want to remove it from their permanent schedule.',
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID to remove from all routines' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
]

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = user.id
    const { messages, language } = await request.json()

    const [profileResult, cycleResult] = await Promise.all([
        supabase.from('user_profiles')
            .select('display_name, training_goal, weight_unit, timezone')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase.from('training_cycles')
            .select('id, cycle_length, start_date')
            .eq('user_id', userId)
            .maybeSingle(),
    ])

    const profile = profileResult.data
    const cycle = cycleResult.data
    const userTimezone = profile?.timezone ?? 'America/New_York'

    function localDateStr(date: Date): string {
        return date.toLocaleDateString('en-CA', { timeZone: userTimezone })
    }

    function localDateToUtcRange(dateStr: string): { start: string; end: string } {
        const testDate = new Date(`${dateStr}T12:00:00Z`)
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: userTimezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        })
        const parts = formatter.formatToParts(testDate)
        const p: Record<string, string> = {}
        parts.forEach(({ type, value }) => { p[type] = value })
        const tzOffset = testDate.getTime() - new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`).getTime()

        return {
            start: new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + tzOffset).toISOString(),
            end: new Date(new Date(`${dateStr}T23:59:59Z`).getTime() + tzOffset).toISOString(),
        }
    }

    // 取得今天課表的 routine_id 和 dayIndex
    async function getTodayRoutineId(): Promise<string | null> {
        if (!cycle) return null
        const todayStr = localDateStr(new Date())
        const startDate = new Date(cycle.start_date + 'T12:00:00Z')
        const todayDate = new Date(todayStr + 'T12:00:00Z')
        const daysSince = Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        const dayIndex = ((daysSince % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length + 1
        const { data: cycleDay } = await supabase
            .from('cycle_days')
            .select('routine_id')
            .eq('training_cycle_id', cycle.id)
            .eq('day_index', dayIndex)
            .maybeSingle()
        return cycleDay?.routine_id ?? null
    }

    // 確保今天有 workout（如果沒有，從 routine 建立）
    async function ensureTodayWorkout(): Promise<string | null> {
        const todayStr = localDateStr(new Date())
        const range = localDateToUtcRange(todayStr)

        const { data: existing } = await supabase
            .from('workouts')
            .select('id')
            .eq('user_id', userId)
            .gte('performed_at', range.start)
            .lte('performed_at', range.end)
            .limit(1)
            .maybeSingle()

        if (existing) return existing.id

        // 建立新 workout
        const { data: newWorkout, error } = await supabase
            .from('workouts')
            .insert({ user_id: userId, performed_at: new Date().toISOString() })
            .select('id')
            .single()

        if (error || !newWorkout) return null

        // 從 routine 複製今天的動作
        const routineId = await getTodayRoutineId()
        if (routineId) {
            const { data: routineExercises } = await supabase
                .from('routine_exercises')
                .select('exercise_id')
                .eq('routine_id', routineId)
                .order('order_index')

            if (routineExercises?.length) {
                const rows = routineExercises.map((re: { exercise_id: string }) => ({
                    workout_id: newWorkout.id,
                    exercise_id: re.exercise_id,
                    user_id: userId,
                }))
                await supabase.from('workout_planned_exercises').insert(rows)
            }
        }

        return newWorkout.id
    }

    let todayRoutineName: string | null = null
    if (cycle) {
        const routineId = await getTodayRoutineId()
        if (routineId) {
            const { data: routine } = await supabase
                .from('routines')
                .select('name')
                .eq('id', routineId)
                .maybeSingle()
            todayRoutineName = routine?.name ?? null
        }
    }

    const userContext = {
        displayName: profile?.display_name ?? null,
        goal: profile?.training_goal ?? null,
        todayRoutineName,
        weightUnit: profile?.weight_unit ?? 'kg',
        timezone: userTimezone,
        todayDate: localDateStr(new Date()),
    }

    const systemPrompt = buildSystemPrompt(language, userContext)

    // 簡單 flag 追蹤是否需要 reload
    let needsDashboardReload = false

    async function executeTool(toolName: string, toolInput: Record<string, string>): Promise<string> {

        if (toolName === 'get_routine_exercises') {
            const { data: routines } = await supabase
                .from('routines')
                .select('id, name')
                .eq('user_id', userId)
                .ilike('name', `%${toolInput.routine_name}%`)

            if (!routines?.length) {
                return language === 'zh-TW'
                    ? `找不到叫「${toolInput.routine_name}」的課表`
                    : `No routine found named "${toolInput.routine_name}"`
            }

            const routine = routines[0]
            const { data: exercises } = await supabase
                .from('routine_exercises')
                .select('target_sets, target_reps, order_index, exercises(name, name_zh_tw, muscle_group)')
                .eq('routine_id', routine.id)
                .order('order_index')

            if (!exercises?.length) {
                return language === 'zh-TW'
                    ? `「${routine.name}」裡面沒有動作`
                    : `"${routine.name}" has no exercises`
            }

            const zh = language === 'zh-TW'
            const list = exercises.map((ex: {
                target_sets: number | null
                target_reps: number | null
                exercises: { name: string; name_zh_tw: string | null; muscle_group: string } | null
            }) => {
                const name = zh && ex.exercises?.name_zh_tw
                    ? ex.exercises.name_zh_tw : ex.exercises?.name ?? 'Unknown'
                return `${name}: ${ex.target_sets ?? '?'}組 × ${ex.target_reps ?? '?'}下`
            }).join('\n')

            return zh
                ? `「${routine.name}」的動作：\n${list}`
                : `"${routine.name}" exercises:\n${list}`
        }

        if (toolName === 'remove_exercise_from_routine') {
            // 從所有課表移除這個動作
            const { data: userRoutines } = await supabase
                .from('routines')
                .select('id')
                .eq('user_id', userId)

            if (!userRoutines?.length) {
                return language === 'zh-TW' ? '你沒有固定課表' : 'No routines found'
            }

            const routineIds = userRoutines.map((r) => r.id)
            const { error } = await supabase
                .from('routine_exercises')
                .delete()
                .in('routine_id', routineIds)
                .eq('exercise_id', toolInput.exercise_id)

            if (error) return language === 'zh-TW' ? `移除失敗：${error.message}` : `Failed: ${error.message}`
            needsDashboardReload = true
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」從所有固定課表永久移除`
                : `✓ Permanently removed "${toolInput.exercise_name}" from all your routines`
        }

        if (toolName === 'search_exercises') {
            let query = supabase.from('exercises').select('id, name, name_zh_tw, muscle_group')
            if (toolInput.query) {
                query = query.or(`name.ilike.%${toolInput.query}%,name_zh_tw.ilike.%${toolInput.query}%`)
            }
            if (toolInput.muscle_group) query = query.eq('muscle_group', toolInput.muscle_group)
            const { data } = await query.limit(10)
            if (!data?.length) return language === 'zh-TW' ? '找不到符合的動作' : 'No exercises found'
            return data.map((ex) => {
                const name = language === 'zh-TW' && ex.name_zh_tw ? ex.name_zh_tw : ex.name
                return `ID: ${ex.id} | ${name} (${ex.muscle_group})`
            }).join('\n')
        }

        if (toolName === 'get_workout_history') {
            const fromRange = localDateToUtcRange(toolInput.date_from)
            const toRange = localDateToUtcRange(toolInput.date_to)

            const { data: workouts } = await supabase
                .from('workouts')
                .select(`id, performed_at, workout_planned_exercises(exercise_id, exercises(name, name_zh_tw))`)
                .eq('user_id', userId)
                .gte('performed_at', fromRange.start)
                .lte('performed_at', toRange.end)
                .order('performed_at')

            if (!workouts?.length) return language === 'zh-TW' ? '這段期間沒有訓練記錄' : 'No workouts found'

            const workoutIds = workouts.map((w) => w.id)
            const { data: allSets } = await supabase
                .from('workout_sets')
                .select('workout_id, exercise_id, reps, weight_kg')
                .in('workout_id', workoutIds)

            return workouts.map((w) => {
                const date = new Date(w.performed_at).toLocaleDateString(
                    language === 'zh-TW' ? 'zh-TW' : 'en-US',
                    { timeZone: userTimezone, month: 'long', day: 'numeric', weekday: 'short' }
                )
                const exercises = (w.workout_planned_exercises ?? []).map((pe: {
                    exercise_id: string
                    exercises: { name: string; name_zh_tw: string | null } | null
                }) => {
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
            const todayStr = localDateStr(new Date())
            const range = localDateToUtcRange(todayStr)

            const { data: workout } = await supabase
                .from('workouts')
                .select(`id, workout_planned_exercises(exercise_id, exercises(name, name_zh_tw))`)
                .eq('user_id', userId)
                .gte('performed_at', range.start)
                .lte('performed_at', range.end)
                .order('performed_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (workout) {
                const { data: todaySets } = await supabase
                    .from('workout_sets')
                    .select('exercise_id, reps, weight_kg')
                    .eq('workout_id', workout.id)

                const exercises = (workout.workout_planned_exercises ?? []).map((pe: {
                    exercise_id: string
                    exercises: { name: string; name_zh_tw: string | null } | null
                }) => {
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
            const routineId = await getTodayRoutineId()
            if (routineId) {
                const { data: routineExercises } = await supabase
                    .from('routine_exercises')
                    .select('exercise_id, target_sets, target_reps, exercises(name, name_zh_tw)')
                    .eq('routine_id', routineId)
                    .order('order_index')

                if (routineExercises?.length) {
                    const zh = language === 'zh-TW'
                    const list = routineExercises.map((re: {
                        exercise_id: string
                        target_sets: number | null
                        target_reps: number | null
                        exercises: { name: string; name_zh_tw: string | null } | null
                    }) => {
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
            const workoutId = await ensureTodayWorkout()
            if (!workoutId) return language === 'zh-TW' ? '建立今日訓練失敗' : 'Failed to create workout'

            const { error } = await supabase
                .from('workout_planned_exercises')
                .insert({ workout_id: workoutId, exercise_id: toolInput.exercise_id, user_id: userId })

            if (error) return language === 'zh-TW' ? `新增失敗：${error.message}` : `Failed: ${error.message}`
            needsDashboardReload = true
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」加入今天的課表`
                : `✓ Added "${toolInput.exercise_name}" to today's workout`
        }

        if (toolName === 'remove_exercise_today') {
            console.log('remove_exercise_today called with:', toolInput)
            const workoutId = await ensureTodayWorkout()
            console.log('workoutId:', workoutId)
            if (!workoutId) return language === 'zh-TW' ? '建立今日訓練失敗' : 'Failed to create workout'

            const { error } = await supabase
                .from('workout_planned_exercises')
                .delete()
                .eq('workout_id', workoutId)
                .eq('exercise_id', toolInput.exercise_id)

            if (error) return language === 'zh-TW' ? `移除失敗：${error.message}` : `Failed: ${error.message}`
            needsDashboardReload = true
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」從今天課表移除（不影響固定課表）`
                : `✓ Removed "${toolInput.exercise_name}" from today only (routine unchanged)`
        }

        return 'Tool not found'
    }

    try {
        let currentMessages = [...messages]

        for (let i = 0; i < 5; i++) {
            const response = await client.messages.create({
                model: 'claude-haiku-4-5',
                max_tokens: 1024,
                system: systemPrompt,
                tools: TOOLS,
                messages: currentMessages,
            })

            if (response.stop_reason === 'end_turn') {
                const rawText = response.content
                    .filter((b) => b.type === 'text')
                    .map((b) => (b as { type: 'text'; text: string }).text)
                    .join('')
                return NextResponse.json({
                    message: stripMarkdown(rawText),
                    reloadDashboard: needsDashboardReload,
                })
            }

            if (response.stop_reason === 'tool_use') {
                const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
                const toolResults: Anthropic.MessageParam = {
                    role: 'user',
                    content: await Promise.all(
                        toolUseBlocks.map(async (block) => {
                            const tb = block as {
                                type: 'tool_use'
                                id: string
                                name: string
                                input: Record<string, string>
                            }
                            const result = await executeTool(tb.name, tb.input)
                            return {
                                type: 'tool_result' as const,
                                tool_use_id: tb.id,
                                content: result,
                            }
                        })
                    ),
                }

                currentMessages = [
                    ...currentMessages,
                    { role: 'assistant' as const, content: response.content },
                    toolResults,
                ]
            }
        }

        return NextResponse.json({
            message: language === 'zh-TW' ? '抱歉，請再問一次。' : 'Sorry, please try again.',
            reloadDashboard: false,
        })

    } catch (err) {
        console.error('Ronnie error:', err)
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}