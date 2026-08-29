import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function buildSystemPrompt(language: string, userContext: {
    displayName: string | null
    goal: string | null
    todayRoutineName: string | null
    weightUnit: string
}) {
    const zh = language === 'zh-TW'
    const name = userContext.displayName || (zh ? '訓練者' : 'athlete')

    if (zh) {
        return `你是 Ronnie，GymPro 的 AI 隨身健身教練，以傳奇健美選手 Ronnie Coleman 命名。
你專業、直接、有點硬派，偶爾說句 "Ain't nothin' but a peanut!" 但保持親切。

使用者資訊：
- 名字：${name}
- 長期目標：${userContext.goal ?? '未設定'}
- 今天的課表：${userContext.todayRoutineName ?? '沒有課表'}
- 重量單位：${userContext.weightUnit}

你只能回答以下範疇的問題：
1. 健身知識（動作技術、替代動作、組數/重量建議、恢復、運動營養）
2. 查詢使用者的訓練歷史記錄
3. 修改今天的課表（新增/刪除動作）
4. GymPro APP 使用說明

GymPro APP 功能說明：
- 主頁：查看今天課表、記錄訓練組數、週期打卡
- 訓練課表：建立和管理課表、設定訓練循環、用 Coach G 設計課表
- 訓練紀錄：查看歷史訓練日誌、體重趨勢、AI 訓練報告
- 設定：修改個人資料、語言、重量單位、顯示模式
- 打卡：每個訓練週期結束時確認體重，觸發 AI 分析
- Coach G：AI 課表設計師，透過對話設計完整訓練計畫

如果使用者問 AI 報告的內容，告訴他去「訓練紀錄」頁面查看。
如果使用者想重新設計完整課表，告訴他去「訓練課表」頁面使用 Coach G。
如果使用者問的問題跟健身或 APP 完全無關，禮貌地說你只能回答健身和 APP 相關的問題。

回答要簡潔，不要太長。使用繁體中文回答。`
    }

    return `You are Ronnie, GymPro's AI personal fitness coach, named after the legendary bodybuilder Ronnie Coleman.
You are professional, direct, and a bit hardcore. Occasionally drop a "Ain't nothin' but a peanut!" but stay friendly.

User info:
- Name: ${name}
- Long-term goal: ${userContext.goal ?? 'not set'}
- Today's routine: ${userContext.todayRoutineName ?? 'no routine'}
- Weight unit: ${userContext.weightUnit}

You can ONLY answer questions in these areas:
1. Fitness knowledge (exercise technique, alternatives, set/rep/weight advice, recovery, sports nutrition)
2. Query the user's training history
3. Modify today's workout (add/remove exercises)
4. GymPro APP usage guidance

GymPro APP features:
- Home: view today's workout, log sets, period check-in
- Routines: create and manage routines, set training cycles, use Coach G to design routines
- History: view training log, weight trends, AI training reports
- Settings: personal info, language, weight unit, display mode
- Check-in: confirm weight at end of training period, triggers AI analysis
- Coach G: AI routine designer, designs complete training plans through conversation

If asked about AI report content, direct them to the History page.
If asked to redesign their full routine, direct them to use Coach G in the Routines page.
If asked anything unrelated to fitness or the APP, politely say you only answer fitness and APP questions.

Keep answers concise. Respond in English.`
}

const TOOLS: Anthropic.Tool[] = [
    {
        name: 'search_exercises',
        description: 'Search the exercise database to find exercises by name or muscle group.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search term (exercise name or partial name)' },
                muscle_group: { type: 'string', description: 'Filter by muscle group (optional): chest, back, shoulders, biceps, triceps, legs, glutes, core' },
            },
            required: [],
        },
    },
    {
        name: 'get_workout_history',
        description: "Get the user's workout history for a date range.",
        input_schema: {
            type: 'object' as const,
            properties: {
                date_from: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
                date_to: { type: 'string', description: 'End date in YYYY-MM-DD format' },
            },
            required: ['date_from', 'date_to'],
        },
    },
    {
        name: 'get_today_workout',
        description: "Get the user's current workout for today.",
        input_schema: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
    },
    {
        name: 'add_exercise_today',
        description: "Add an exercise to today's workout. First use search_exercises to get the exercise ID.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'The exercise ID from search_exercises' },
                exercise_name: { type: 'string', description: 'Human-readable exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
    {
        name: 'remove_exercise_today',
        description: "Remove an exercise from today's workout.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'The exercise ID to remove' },
                exercise_name: { type: 'string', description: 'Human-readable exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
]

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 把 user.id 存成 userId，讓 TypeScript 確定它不是 null
    const userId = user.id

    const { messages, language } = await request.json()

    // 取得使用者 context
    const [profileResult, cycleResult] = await Promise.all([
        supabase.from('user_profiles')
            .select('display_name, training_goal, weight_unit')
            .eq('user_id', userId)
            .maybeSingle(),
        supabase.from('training_cycles')
            .select('id, cycle_length, start_date')
            .eq('user_id', userId)
            .maybeSingle(),
    ])

    const profile = profileResult.data
    const cycle = cycleResult.data

    // 今天的課表名稱
    let todayRoutineName: string | null = null
    if (cycle) {
        const today = new Date()
        const startDate = new Date(cycle.start_date + 'T00:00:00Z')
        const daysSince = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        const dayIndex = (daysSince % cycle.cycle_length) + 1
        const { data: cycleDay } = await supabase
            .from('cycle_days')
            .select('routine_id, routines(name)')
            .eq('training_cycle_id', cycle.id)
            .eq('day_index', dayIndex)
            .maybeSingle()
        todayRoutineName = (cycleDay?.routines as { name: string } | null)?.name ?? null
    }

    const userContext = {
        displayName: profile?.display_name ?? null,
        goal: profile?.training_goal ?? null,
        todayRoutineName,
        weightUnit: profile?.weight_unit ?? 'kg',
    }

    const systemPrompt = buildSystemPrompt(language, userContext)

    // Tool execution
    async function executeTool(toolName: string, toolInput: Record<string, string>): Promise<string> {

        if (toolName === 'search_exercises') {
            let query = supabase.from('exercises').select('id, name, name_zh_tw, muscle_group')
            if (toolInput.query) query = query.ilike('name', `%${toolInput.query}%`)
            if (toolInput.muscle_group) query = query.eq('muscle_group', toolInput.muscle_group)
            const { data } = await query.limit(10)
            if (!data?.length) return language === 'zh-TW' ? '找不到符合的動作' : 'No exercises found'
            return data.map((ex) => {
                const name = language === 'zh-TW' && ex.name_zh_tw ? ex.name_zh_tw : ex.name
                return `ID: ${ex.id} | ${name} (${ex.muscle_group})`
            }).join('\n')
        }

        if (toolName === 'get_workout_history') {
            // 查 workouts（不嵌套 workout_sets）
            const { data: workouts } = await supabase
                .from('workouts')
                .select(`
                    id,
                    performed_at,
                    workout_planned_exercises(
                        exercise_id,
                        exercises(name, name_zh_tw)
                    )
                `)
                .eq('user_id', userId)
                .gte('performed_at', toolInput.date_from + 'T00:00:00Z')
                .lte('performed_at', toolInput.date_to + 'T23:59:59Z')
                .order('performed_at')

            if (!workouts?.length) return language === 'zh-TW' ? '這段期間沒有訓練記錄' : 'No workouts found in this period'

            // 分開查 workout_sets
            const workoutIds = workouts.map((w) => w.id)
            const { data: allSets } = await supabase
                .from('workout_sets')
                .select('workout_id, exercise_id, reps, weight_kg')
                .in('workout_id', workoutIds)

            return workouts.map((w) => {
                const date = new Date(w.performed_at).toLocaleDateString(
                    language === 'zh-TW' ? 'zh-TW' : 'en-US'
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
            const today = new Date()
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
            const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString()

            const { data: workout } = await supabase
                .from('workouts')
                .select(`
                    id,
                    workout_planned_exercises(
                        exercise_id,
                        exercises(name, name_zh_tw)
                    )
                `)
                .eq('user_id', userId)
                .gte('performed_at', startOfDay)
                .lte('performed_at', endOfDay)
                .order('performed_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (!workout) return language === 'zh-TW' ? '今天還沒有訓練記錄' : 'No workout logged today yet'

            // 分開查 workout_sets
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
                return `${exName}: ${sets || (language === 'zh-TW' ? '尚未記錄組數' : 'no sets logged')}`
            }).join('\n')

            return exercises || (language === 'zh-TW' ? '今天課表是空的' : 'No exercises today')
        }

        if (toolName === 'add_exercise_today') {
            const today = new Date()
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
            const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString()

            let workoutId: string

            const { data: existing } = await supabase
                .from('workouts')
                .select('id')
                .eq('user_id', userId)
                .gte('performed_at', startOfDay)
                .lte('performed_at', endOfDay)
                .limit(1)
                .maybeSingle()

            if (existing) {
                workoutId = existing.id
            } else {
                const { data: newWorkout, error } = await supabase
                    .from('workouts')
                    .insert({ user_id: userId, performed_at: new Date().toISOString() })
                    .select('id')
                    .single()
                if (error || !newWorkout) return language === 'zh-TW' ? '新增失敗' : 'Failed to create workout'
                workoutId = newWorkout.id
            }

            const { error } = await supabase
                .from('workout_planned_exercises')
                .insert({ workout_id: workoutId, exercise_id: toolInput.exercise_id, user_id: userId })

            if (error) return language === 'zh-TW' ? `新增失敗：${error.message}` : `Failed: ${error.message}`
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」加入今天的課表`
                : `✓ Added "${toolInput.exercise_name}" to today's workout`
        }

        if (toolName === 'remove_exercise_today') {
            const today = new Date()
            const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
            const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString()

            const { data: workout } = await supabase
                .from('workouts')
                .select('id')
                .eq('user_id', userId)
                .gte('performed_at', startOfDay)
                .lte('performed_at', endOfDay)
                .limit(1)
                .maybeSingle()

            if (!workout) return language === 'zh-TW' ? '今天沒有訓練記錄' : 'No workout today'

            const { error } = await supabase
                .from('workout_planned_exercises')
                .delete()
                .eq('workout_id', workout.id)
                .eq('exercise_id', toolInput.exercise_id)

            if (error) return language === 'zh-TW' ? `刪除失敗：${error.message}` : `Failed: ${error.message}`
            return language === 'zh-TW'
                ? `✓ 已將「${toolInput.exercise_name}」從今天課表移除`
                : `✓ Removed "${toolInput.exercise_name}" from today's workout`
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
                const text = response.content
                    .filter((b) => b.type === 'text')
                    .map((b) => (b as { type: 'text'; text: string }).text)
                    .join('')
                return NextResponse.json({ message: text })
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
            message: language === 'zh-TW'
                ? '抱歉，我需要更多時間思考這個問題，請再問一次。'
                : 'Sorry, let me try again.',
        })

    } catch (err) {
        console.error('Ronnie error:', err)
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}