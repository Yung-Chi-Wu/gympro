import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function buildSystemPrompt(language: string, userContext: {
    displayName: string | null
    goal: string | null
    todayRoutineName: string | null
    weightUnit: string
    timezone: string
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
- 時區：${userContext.timezone}

你只能回答以下範疇：
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

如果使用者問 AI 報告，告訴他去「訓練紀錄」查看。
如果使用者想重新設計完整課表，告訴他去「訓練課表」用 Coach G。
如果問題跟健身或 APP 無關，禮貌拒絕。

格式規則（非常重要）：
- 可以用 emoji（如 💪 ✅ ⚠️）
- 絕對不能用 Markdown（不能用 **粗體**、不能用 ---、不能用 # 標題）
- 回答要簡短，最多 5-6 句話，不要長篇大論
- 用換行分段，不要用符號清單
- 繁體中文回答`
    }

    return `You are Ronnie, GymPro's AI personal fitness coach, named after the legendary bodybuilder Ronnie Coleman.
Professional, direct, a bit hardcore. Occasionally drop "Ain't nothin' but a peanut!" but stay friendly.

User info:
- Name: ${name}
- Goal: ${userContext.goal ?? 'not set'}
- Today's routine: ${userContext.todayRoutineName ?? 'no routine'}
- Weight unit: ${userContext.weightUnit}
- Timezone: ${userContext.timezone}

You can ONLY answer:
1. Fitness knowledge (technique, alternatives, sets/reps/weight, recovery, nutrition)
2. Query training history
3. Modify today's workout (add/remove exercises)
4. GymPro APP guidance

GymPro features:
- Home: today's workout, log sets, period check-in
- Routines: manage routines, training cycles, Coach G
- History: training log, weight trends, AI reports
- Settings: profile, language, weight unit, display mode
- Check-in: confirm weight at period end, triggers AI analysis
- Coach G: AI routine designer

For AI report content → History page.
For full routine redesign → Coach G in Routines.
Off-topic → politely decline.

Format rules (very important):
- Emojis are OK (💪 ✅ ⚠️)
- NO Markdown (no **bold**, no ---, no # headers)
- Keep it SHORT — max 5-6 sentences
- Use line breaks for paragraphs, not bullet symbols
- Respond in English`
}

const TOOLS: Anthropic.Tool[] = [
    {
        name: 'search_exercises',
        description: 'Search the exercise database to find exercises by name or muscle group.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search term' },
                muscle_group: { type: 'string', description: 'Filter by muscle group (optional)' },
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
                date_from: { type: 'string', description: 'Start date YYYY-MM-DD in user local time' },
                date_to: { type: 'string', description: 'End date YYYY-MM-DD in user local time' },
            },
            required: ['date_from', 'date_to'],
        },
    },
    {
        name: 'get_today_workout',
        description: "Get the user's workout for today.",
        input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
    {
        name: 'add_exercise_today',
        description: "Add an exercise to today's workout. Use search_exercises first to get the ID.",
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
        description: "Remove an exercise from today's workout.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID to remove' },
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
    const userTimezone = profile?.timezone ?? 'UTC'

    // Timezone helpers
    function getUtcOffset(date: Date, tz: string): number {
        const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
        const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }))
        return utcDate.getTime() - tzDate.getTime()
    }

    function toTzStartOfDay(dateStr: string): string {
        const local = new Date(`${dateStr}T00:00:00`)
        return new Date(local.getTime() + getUtcOffset(local, userTimezone)).toISOString()
    }

    function toTzEndOfDay(dateStr: string): string {
        const local = new Date(`${dateStr}T23:59:59`)
        return new Date(local.getTime() + getUtcOffset(local, userTimezone)).toISOString()
    }

    function todayInTz(): string {
        return new Date().toLocaleDateString('en-CA', { timeZone: userTimezone })
    }

    // Today's routine name
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
        timezone: userTimezone,
    }

    const systemPrompt = buildSystemPrompt(language, userContext)

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
            const { data: workouts } = await supabase
                .from('workouts')
                .select(`
                    id, performed_at,
                    workout_planned_exercises(
                        exercise_id,
                        exercises(name, name_zh_tw)
                    )
                `)
                .eq('user_id', userId)
                .gte('performed_at', toTzStartOfDay(toolInput.date_from))
                .lte('performed_at', toTzEndOfDay(toolInput.date_to))
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
                    { timeZone: userTimezone }
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
            const today = todayInTz()
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
                .gte('performed_at', toTzStartOfDay(today))
                .lte('performed_at', toTzEndOfDay(today))
                .order('performed_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            if (!workout) return language === 'zh-TW' ? '今天還沒有訓練記錄' : 'No workout logged today'

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
                return `${exName}: ${sets || (language === 'zh-TW' ? '尚未記錄' : 'no sets')}`
            }).join('\n')

            return exercises || (language === 'zh-TW' ? '今天課表是空的' : 'No exercises today')
        }

        if (toolName === 'add_exercise_today') {
            const today = todayInTz()
            let workoutId: string

            const { data: existing } = await supabase
                .from('workouts')
                .select('id')
                .eq('user_id', userId)
                .gte('performed_at', toTzStartOfDay(today))
                .lte('performed_at', toTzEndOfDay(today))
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
                if (error || !newWorkout) return language === 'zh-TW' ? '新增失敗' : 'Failed'
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
            const today = todayInTz()
            const { data: workout } = await supabase
                .from('workouts')
                .select('id')
                .eq('user_id', userId)
                .gte('performed_at', toTzStartOfDay(today))
                .lte('performed_at', toTzEndOfDay(today))
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
                max_tokens: 512,
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
                ? '抱歉，請再問一次。'
                : 'Sorry, please try again.',
        })

    } catch (err) {
        console.error('Ronnie error:', err)
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}