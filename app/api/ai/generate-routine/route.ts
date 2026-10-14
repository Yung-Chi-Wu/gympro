import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { errorText } from '@/lib/ai/trace'
import { traceAfterResponse } from '@/lib/ai/trace-after'
import { cleanRoutines, COACH_CYCLE_DAYS, parseGenerateRequest, type LibraryExercise } from '@/lib/coach-g'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // The chat's answers, each short (lib/coach-g.ts); anything else is refused, not crashed on
    const info = parseGenerateRequest(await request.json().catch(() => null))
    if (!info) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
    const { zh, trainingDays } = info

    const [{ data: exercises, error: exercisesError }, { data: profile }] = await Promise.all([
        supabase
            .from('exercises')
            .select('id, name, name_zh_tw, muscle_group, equipment')
            .order('muscle_group')
            .order('name'),
        // The goal from the profile, as Settings saved it, not whatever a request says
        supabase.from('user_profiles').select('training_goal').eq('user_id', user.id).maybeSingle(),
    ])
    if (exercisesError) {
        console.error('Coach G exercises not read:', exercisesError.message)
        return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
    }

    const equipmentKeywords = buildEquipmentFilter(info.equipment)
    const filteredExercises = (exercises ?? []).filter((ex) => {
        if (!ex.equipment) return info.equipment.some((e) =>
            e.toLowerCase().includes('bodyweight') || e.toLowerCase().includes('徒手')
        )
        return equipmentKeywords.some((kw) =>
            (ex.equipment ?? '').toLowerCase().includes(kw)
        )
    })
    // What the model may use: a routine keeps only exercises from this list
    const library = new Map<string, LibraryExercise>(filteredExercises.map((ex) => [ex.id, ex]))

    const exerciseLines = filteredExercises
        .map((ex) => `${ex.id}|${ex.name}${ex.name_zh_tw ? '|' + ex.name_zh_tw : ''}|${ex.muscle_group}`)
        .join('\n')

    const trainingGoal = profile?.training_goal ?? null
    const goalNote = trainingGoal
        ? (zh ? `長期目標：「${trainingGoal}」` : `Long-term goal: "${trainingGoal}"`) : ''

    const userInfo = zh
        ? `使用者資訊：
- 每週訓練天數：${trainingDays} 天
- 每次時長：${info.duration}
- 器材：${info.equipment.join('、')}
- 目標：${info.goals.join('、')}
- 程度：${info.level}
- 受傷部位：${info.injuries ?? '無'}
- 其他需求：${info.notes ?? '無'}
${goalNote}`
        : `User info:
- Training days per week: ${trainingDays}
- Session duration: ${info.duration}
- Equipment: ${info.equipment.join(', ')}
- Goals: ${info.goals.join(', ')}
- Level: ${info.level}
- Injuries: ${info.injuries ?? 'None'}
- Other notes: ${info.notes ?? 'None'}
${goalNote}`

    const systemPrompt = zh
        ? `你是 Coach G，專業健身教練。根據使用者資訊設計課表。

⚠️ 最重要規則：
- 訓練循環是一週 ${COACH_CYCLE_DAYS} 天，cycle_length 必須是 ${COACH_CYCLE_DAYS}
- 一週剛好排 ${trainingDays} 天訓練，其餘 ${COACH_CYCLE_DAYS - trainingDays} 天休息，休息日盡量分散
- day_indices 在 1 到 ${COACH_CYCLE_DAYS} 之間，同一天只能排一個課表
- 只能使用下方清單的動作，必須用正確的 exercise_id
- 每個動作只寫 exercise_id、target_sets、target_reps，動作名稱由 app 補上，不要寫
- 每個課表提供中文名稱（name_zh_tw）
- 只輸出 JSON，不輸出其他文字

動作清單（格式：id|英文名|中文名|肌群）：
${exerciseLines}

輸出格式（cycle_length 必須是 ${COACH_CYCLE_DAYS}）：
{"action":"generate_routine","message":"鼓勵說明","cycle_length":${COACH_CYCLE_DAYS},"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"清單裡的 id","target_sets":4,"target_reps":8}]}]}`
        : `You are Coach G, a professional fitness coach. Design a routine based on user info.

⚠️ CRITICAL RULES:
- The cycle is one week of ${COACH_CYCLE_DAYS} days: cycle_length MUST be ${COACH_CYCLE_DAYS}
- Train on exactly ${trainingDays} of the ${COACH_CYCLE_DAYS} days and rest on the other ${COACH_CYCLE_DAYS - trainingDays}; spread the rest days out
- day_indices must be between 1 and ${COACH_CYCLE_DAYS}, with at most one routine on a day
- ONLY use exercises from the list below with exact exercise_id
- Write each exercise as only its exercise_id, target_sets and target_reps; the app adds the names
- Provide Chinese name (name_zh_tw) for each routine
- Output ONLY JSON, no other text

Exercise list (id|name|zh_name|muscle_group):
${exerciseLines}

Output format (cycle_length MUST be ${COACH_CYCLE_DAYS}):
{"action":"generate_routine","message":"encouraging summary","cycle_length":${COACH_CYCLE_DAYS},"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"an id from the list","target_sets":4,"target_reps":8}]}]}`

    const model = 'claude-sonnet-4-6'
    const traceInput = { collected: info, system: systemPrompt, user: userInfo }
    const started = Date.now()
    try {
        const response = await client.messages.create({
            model,
            // The routines are ids, sets and reps (names come from the library). With every name
            // written out, 9 exercises a routine ran past 4096 tokens by the fourth routine
            max_tokens: 8192,
            system: systemPrompt,
            messages: [{ role: 'user', content: userInfo }],
        })

        const rawText = response.content[0].type === 'text'
            ? response.content[0].text.trim() : ''
        // An answer with no usable routine fails the request, so its trace counts as an error
        const trace = (error: string | null, kept?: unknown) => traceAfterResponse({
            userId: user.id, feature: 'coach_routine', model, servedModel: response.model, status: error ? 'error' : 'ok', error,
            latencyMs: Date.now() - started, usage: [response.usage], input: traceInput,
            output: { text: rawText, stopReason: response.stop_reason, ...(kept ? { kept } : {}) },
        })

        // Cut off at the token limit, the JSON is incomplete
        if (response.stop_reason === 'max_tokens') {
            trace('the answer was cut off at max_tokens')
            return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
        }

        const startIdx = rawText.indexOf('{')
        const endIdx = rawText.lastIndexOf('}')

        if (startIdx !== -1 && endIdx !== -1) {
            try {
                const parsed = JSON.parse(rawText.slice(startIdx, endIdx + 1))
                // Only what can be saved: library exercises, sets and reps in range, a day for one routine at most
                const routines = parsed.action === 'generate_routine' ? cleanRoutines(parsed.routines, library) : []
                if (routines.length) {
                    trace(null, routines)
                    return NextResponse.json({
                        action: 'generate_routine',
                        message: typeof parsed.message === 'string' ? parsed.message : '',
                        cycle_length: COACH_CYCLE_DAYS,
                        routines,
                    })
                }
            } catch { /* 繼續 */ }
        }

        trace('no valid routine in the output')
        return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
    } catch (err) {
        console.error('Coach G generate error:', err)
        traceAfterResponse({
            userId: user.id, feature: 'coach_routine', model, status: 'error', error: errorText(err),
            latencyMs: Date.now() - started, usage: [], input: traceInput,
        })
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}

function buildEquipmentFilter(equipment: string[]): string[] {
    const keywords: string[] = []

    for (const eq of equipment) {
        const lower = eq.toLowerCase()
        if (lower.includes('barbell') || lower.includes('槓鈴')) keywords.push('barbell')
        if (lower.includes('dumbbell') || lower.includes('啞鈴')) keywords.push('dumbbell')
        // "Cable Machine" is the cable option, not the machines one
        if (lower.includes('cable') || lower.includes('纜繩') || lower.includes('滑輪')) keywords.push('cable')
        else if (lower.includes('machine') || lower.includes('器械')) keywords.push('machine')
        if (lower.includes('bodyweight') || lower.includes('徒手')) keywords.push('bodyweight')
    }

    if (!keywords.includes('bodyweight')) keywords.push('bodyweight')

    return keywords
}
