import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

function buildSystemPrompt(
  language: string,
  exercises: { id: string; name: string; name_zh_tw: string | null; muscle_group: string }[],
  trainingGoal: string | null
) {
  const zh = language === 'zh-TW'

  // 精簡格式：只傳 id|name|muscle_group
  const exerciseLines = exercises
    .map((ex) => `${ex.id}|${ex.name}${ex.name_zh_tw ? '|' + ex.name_zh_tw : ''}|${ex.muscle_group}`)
    .join('\n')

  const goalNote = trainingGoal
    ? (zh ? `\n使用者長期目標：「${trainingGoal}」` : `\nUser's goal: "${trainingGoal}"`)
    : ''

  if (zh) {
    return `你是 Coach G，GymPro 的健身教練。透過對話幫使用者設計課表。每次只問一個問題。${goalNote}

依序收集：
1. 每週訓練天數（單選）
2. 每次訓練時長（單選）
3. 可用器材（多選，multi_select:true）
4. 主要目標（多選，multi_select:true）
5. 訓練程度（單選）
6. 受傷部位（單選，有跳過選項）
7. 想加強部位（單選，有跳過選項）

收集完後從下方清單設計課表，只能用清單裡的動作（用正確的 id）。

動作清單格式：id|英文名|中文名|肌群
${exerciseLines}

只輸出 JSON，不輸出任何其他文字。

問問題時：
{"action":"ask","message":"問題","options":["選項"],"multi_select":false}
多選時加 "multi_select":true

生成課表時：
{"action":"generate_routine","message":"說明","cycle_length":6,"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"uuid","exercise_name":"Bench Press","exercise_name_zh_tw":"臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
  }

  return `You are Coach G, GymPro's fitness coach. Design routines through conversation. One question at a time.${goalNote}

Collect in order:
1. Days per week (single select)
2. Session duration (single select)
3. Equipment (multi-select, multi_select:true)
4. Primary goal (multi-select, multi_select:true)
5. Experience level (single select)
6. Injuries (single select, include Skip option)
7. Muscle focus (single select, include Skip option)

After collecting, design routine using ONLY exercises from the list below (use exact id).

Exercise list format: id|name|zh_name|muscle_group
${exerciseLines}

Output ONLY JSON, never plain text.

When asking:
{"action":"ask","message":"question","options":["opt1"],"multi_select":false}
For multi-select add "multi_select":true

When generating:
{"action":"generate_routine","message":"summary","cycle_length":6,"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"uuid","exercise_name":"Bench Press","exercise_name_zh_tw":"臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, language, trainingGoal } = await request.json()

  const { data: exercises } = await supabase
    .from('exercises')
    .select('id, name, name_zh_tw, muscle_group')
    .order('muscle_group')
    .order('name')

  const systemPrompt = buildSystemPrompt(language, exercises ?? [], trainingGoal)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    })

    const rawText = response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : ''

    const startIdx = rawText.indexOf('{')
    const endIdx = rawText.lastIndexOf('}')

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      try {
        const parsed = JSON.parse(rawText.slice(startIdx, endIdx + 1))
        if (parsed.action && parsed.message) {
          return NextResponse.json(parsed)
        }
      } catch {
        // 繼續
      }
    }

    const zh = language === 'zh-TW'
    return NextResponse.json({
      action: 'ask',
      message: zh
        ? '抱歉，請再說一次。'
        : 'Sorry, could you repeat that?',
      options: [],
      multi_select: false,
    })

  } catch (err) {
    console.error('Coach G error:', err)
    return NextResponse.json({
      action: 'ask',
      message: language === 'zh-TW' ? '發生錯誤，請稍後再試。' : 'Something went wrong.',
      options: [],
      multi_select: false,
    }, { status: 500 })
  }
}