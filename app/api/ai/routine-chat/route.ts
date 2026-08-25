import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

function buildSystemPrompt(language: string, exercises: { id: string; name: string; name_zh_tw: string | null; muscle_group: string }[], trainingGoal: string | null) {
  const zh = language === 'zh-TW'

  // 按肌群整理動作清單
  const byMuscle: Record<string, string[]> = {}
  for (const ex of exercises) {
    if (!byMuscle[ex.muscle_group]) byMuscle[ex.muscle_group] = []
    const label = zh && ex.name_zh_tw
      ? `{"id":"${ex.id}","name":"${ex.name}","zh":"${ex.name_zh_tw}"}`
      : `{"id":"${ex.id}","name":"${ex.name}"}`
    byMuscle[ex.muscle_group].push(label)
  }

  const exerciseList = Object.entries(byMuscle)
    .map(([group, exs]) => `${group}: [${exs.join(',')}]`)
    .join('\n')

  const goalNote = trainingGoal ? (zh
    ? `\n\n使用者的長期訓練目標：「${trainingGoal}」`
    : `\n\nUser's long-term training goal: "${trainingGoal}"`) : ''

  if (zh) {
    return `你是 Coach G，GymPro 的專業健身教練和課表設計師。

你的工作是透過友善的對話為使用者設計個人化訓練課表。每次只問一個問題。

你必須依序收集：
1. 每週訓練天數
2. 每次訓練時長
3. 可用器材（可多選：槓鈴、啞鈴、健身房器械、纜繩/滑輪、徒手）
4. 主要目標（增肌/增強力量/減脂/維持體能）
5. 訓練程度（新手/中階/進階）
6. 受傷或要避開的部位（可跳過）
7. 特別想加強的部位（可跳過）

收集完成後，根據下方資料庫動作清單設計課表。

⚠️ 重要規則：
- 只能使用下方清單裡的動作，必須用正確的 exercise_id
- 每個課表名稱必須提供中文（name_zh_tw）
- 必須指定每個課表對應循環的哪幾天（day_indices）
- cycle_length 必須是合理的循環天數（通常比訓練天數多1-2天休息日）
- 只輸出 JSON，不要輸出任何其他文字${goalNote}

可用動作清單（只能用這些）：
${exerciseList}

還在收集資訊時只輸出：
{"action":"ask","message":"問題內容","options":["選項1","選項2"]}

準備生成課表時只輸出：
{"action":"generate_routine","message":"鼓勵性說明","cycle_length":6,"routines":[{"name":"Push Day A","name_zh_tw":"推日 A","day_indices":[1,4],"exercises":[{"exercise_id":"實際uuid","exercise_name":"Barbell Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
  }

  return `You are Coach G, an expert fitness coach for GymPro app.

Design a personalized training routine through friendly conversation. Ask ONE question at a time.

Collect in order:
1. Days per week
2. Session duration
3. Equipment (multi-select: barbell, dumbbells, machines, cables, bodyweight)
4. Primary goal (muscle gain/strength/fat loss/fitness)
5. Experience level (beginner/intermediate/advanced)
6. Injuries or areas to avoid (skippable)
7. Muscle groups to prioritize (skippable)

After collecting info, design the routine using ONLY the exercises from the database below.

⚠️ Critical rules:
- ONLY use exercises from the list below with their exact exercise_id
- Provide Chinese names (name_zh_tw) for all routines and exercises
- Specify which cycle days each routine falls on (day_indices)
- cycle_length should include rest days (usually training days + 1-2 rest days)
- Output ONLY JSON, never plain text${goalNote}

Available exercises (MUST use exact exercise_id):
${exerciseList}

While collecting info output ONLY:
{"action":"ask","message":"your question","options":["Option 1","Option 2"]}

When generating output ONLY:
{"action":"generate_routine","message":"encouraging summary","cycle_length":6,"routines":[{"name":"Push Day A","name_zh_tw":"推日 A","day_indices":[1,4],"exercises":[{"exercise_id":"actual-uuid","exercise_name":"Barbell Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, language, trainingGoal } = await request.json()

  // 從資料庫拿動作清單
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
        ? '抱歉，我剛才的回應有點問題，可以再說一次嗎？'
        : 'Sorry, something went wrong. Could you repeat that?',
      options: [],
    })

  } catch (err) {
    console.error('Coach G error:', err)
    return NextResponse.json({
      action: 'ask',
      message: language === 'zh-TW' ? '發生錯誤，請稍後再試。' : 'Something went wrong. Please try again.',
      options: [],
    }, { status: 500 })
  }
}