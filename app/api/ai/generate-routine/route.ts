import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

interface CollectedInfo {
    days: string
    duration: string
    equipment: string[]
    goals: string[]
    level: string
    injuries: string | null
    notes: string | null
}

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { collected, language, trainingGoal }: {
        collected: CollectedInfo
        language: string
        trainingGoal: string | null
    } = await request.json()

    // 從 days 字串提取數字
    const daysMatch = collected.days.match(/\d+/)
    const numDays = daysMatch ? parseInt(daysMatch[0]) : 4

    const equipmentKeywords = buildEquipmentFilter(collected.equipment, language)
    const { data: exercises } = await supabase
        .from('exercises')
        .select('id, name, name_zh_tw, muscle_group, equipment')
        .order('muscle_group')
        .order('name')

    const filteredExercises = (exercises ?? []).filter((ex) => {
        if (!ex.equipment) return collected.equipment.some((e) =>
            e.toLowerCase().includes('bodyweight') || e.toLowerCase().includes('徒手')
        )
        return equipmentKeywords.some((kw) =>
            (ex.equipment ?? '').toLowerCase().includes(kw)
        )
    })

    const exerciseLines = filteredExercises
        .map((ex) => `${ex.id}|${ex.name}${ex.name_zh_tw ? '|' + ex.name_zh_tw : ''}|${ex.muscle_group}`)
        .join('\n')

    const zh = language === 'zh-TW'
    const goalNote = trainingGoal
        ? (zh ? `長期目標：「${trainingGoal}」` : `Long-term goal: "${trainingGoal}"`) : ''

    const userInfo = zh
        ? `使用者資訊：
- 循環天數：${numDays} 天（cycle_length 必須是 ${numDays}）
- 每次時長：${collected.duration}
- 器材：${collected.equipment.join('、')}
- 目標：${collected.goals.join('、')}
- 程度：${collected.level}
- 受傷部位：${collected.injuries ?? '無'}
- 其他需求：${collected.notes ?? '無'}
${goalNote}`
        : `User info:
- Cycle days: ${numDays} days (cycle_length MUST be ${numDays})
- Session duration: ${collected.duration}
- Equipment: ${collected.equipment.join(', ')}
- Goals: ${collected.goals.join(', ')}
- Level: ${collected.level}
- Injuries: ${collected.injuries ?? 'None'}
- Other notes: ${collected.notes ?? 'None'}
${goalNote}`

    const systemPrompt = zh
        ? `你是 Coach G，專業健身教練。根據使用者資訊設計課表。

⚠️ 最重要規則：
- cycle_length 必須完全等於使用者指定的循環天數（${numDays} 天），絕對不能是其他數字
- day_indices 必須在 1 到 ${numDays} 之間
- AI 可以決定哪幾天練、哪幾天休息，但 cycle_length 固定是 ${numDays}
- 只能使用下方清單的動作，必須用正確的 exercise_id
- 每個課表提供中文名稱（name_zh_tw）
- 只輸出 JSON，不輸出其他文字

動作清單（格式：id|英文名|中文名|肌群）：
${exerciseLines}

輸出格式（cycle_length 必須是 ${numDays}）：
{"action":"generate_routine","message":"鼓勵說明","cycle_length":${numDays},"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"uuid","exercise_name":"Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
        : `You are Coach G, a professional fitness coach. Design a routine based on user info.

⚠️ CRITICAL RULES:
- cycle_length MUST exactly equal ${numDays} (the user's specified days) — no exceptions
- day_indices must be between 1 and ${numDays}
- AI decides which days to train vs rest, but cycle_length is always ${numDays}
- ONLY use exercises from the list below with exact exercise_id
- Provide Chinese name (name_zh_tw) for each routine
- Output ONLY JSON, no other text

Exercise list (id|name|zh_name|muscle_group):
${exerciseLines}

Output format (cycle_length MUST be ${numDays}):
{"action":"generate_routine","message":"encouraging summary","cycle_length":${numDays},"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"uuid","exercise_name":"Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`

    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userInfo }],
        })

        const rawText = response.content[0].type === 'text'
            ? response.content[0].text.trim() : ''

        const startIdx = rawText.indexOf('{')
        const endIdx = rawText.lastIndexOf('}')

        if (startIdx !== -1 && endIdx !== -1) {
            try {
                const parsed = JSON.parse(rawText.slice(startIdx, endIdx + 1))
                if (parsed.action === 'generate_routine') {
                    // 強制確保 cycle_length 正確
                    parsed.cycle_length = numDays
                    return NextResponse.json(parsed)
                }
            } catch { /* 繼續 */ }
        }

        return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
    } catch (err) {
        console.error('Coach G generate error:', err)
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}

function buildEquipmentFilter(equipment: string[], language: string): string[] {
    const keywords: string[] = []

    for (const eq of equipment) {
        const lower = eq.toLowerCase()
        if (lower.includes('barbell') || lower.includes('槓鈴')) keywords.push('barbell')
        if (lower.includes('dumbbell') || lower.includes('啞鈴')) keywords.push('dumbbell')
        if (lower.includes('machine') || lower.includes('器械')) keywords.push('machine')
        if (lower.includes('cable') || lower.includes('纜繩') || lower.includes('滑輪')) keywords.push('cable')
        if (lower.includes('bodyweight') || lower.includes('徒手')) keywords.push('bodyweight')
    }

    if (!keywords.includes('bodyweight')) keywords.push('bodyweight')

    return keywords
}