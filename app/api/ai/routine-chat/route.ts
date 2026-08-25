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
  const exerciseLines = exercises
    .map((ex) => `${ex.id}|${ex.name}${ex.name_zh_tw ? '|' + ex.name_zh_tw : ''}|${ex.muscle_group}`)
    .join('\n')

  const goalNote = trainingGoal
    ? (zh ? `\n使用者長期目標：「${trainingGoal}」，設計課表時納入考量。` : `\nUser's long-term goal: "${trainingGoal}". Factor this into the routine design.`)
    : ''

  if (zh) {
    return `你是 Coach G，GymPro 的專業健身教練。透過對話幫使用者設計個人化訓練課表。${goalNote}

重要規則：
- 每次只問一個問題
- 仔細讀對話歷史，已經得到答案的問題不要再問
- 使用者說「跳過」或「沒有」代表沒有該項資訊，直接進入下一個問題
- 收集完所有必要資訊後立刻生成課表，不要再問多餘問題
- 只輸出 JSON，絕對不輸出任何其他文字

必須收集的資訊（依序）：
1. 每週訓練天數 → 選項：2天/3天/4天/5天/6天/7天
2. 每次訓練時長 → 選項：30分鐘/45分鐘/60分鐘/90分鐘以上
3. 可用器材（多選）→ 選項：槓鈴、啞鈴、健身房器械、纜繩滑輪、徒手訓練，multi_select:true
4. 主要目標（多選）→ 選項：增肌、增強力量、減脂、維持體能，multi_select:true
5. 訓練程度 → 選項：新手（不到1年）/中階（1-3年）/進階（3年以上）
6. 受傷部位 → 選項：沒有/肩膀/膝蓋/下背/手腕，說明使用者可跳過
7. 想加強部位 → 選項：胸/背/肩/手臂/腿/臀/核心/沒有特別，說明使用者可跳過

收集完1-5後就可以生成課表，6-7是選填。

設計課表規則：
- 只能使用下方清單的動作，必須用正確的 exercise_id
- 指定每個課表對應循環的哪幾天（day_indices）
- cycle_length 包含休息日

動作清單（格式：id|英文名|中文名|肌群）：
${exerciseLines}

問問題時輸出（multi_select 預設 false）：
{"action":"ask","message":"問題內容","options":["選項1","選項2"],"multi_select":false}

生成課表時輸出：
{"action":"generate_routine","message":"鼓勵說明","cycle_length":7,"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"uuid","exercise_name":"Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
  }

  return `You are Coach G, GymPro's professional fitness coach. Design personalized routines through conversation.${goalNote}

Critical rules:
- Ask ONE question at a time
- Read the conversation history carefully — NEVER ask a question you already have the answer to
- If user says "Skip" or "None", accept it and move to the next question immediately
- Once you have info for items 1-5, generate the routine — don't ask unnecessary questions
- Output ONLY JSON, never plain text

Collect in order:
1. Days per week → options: 2 days/3 days/4 days/5 days/6 days/7 days
2. Session duration → options: 30 min/45 min/60 min/90+ min
3. Equipment (multi-select) → options: Barbell, Dumbbell, Gym Machines, Cable Machine, Bodyweight, multi_select:true
4. Primary goal (multi-select) → options: Build Muscle, Increase Strength, Lose Fat, Stay Fit, multi_select:true
5. Experience level → options: Beginner (<1yr)/Intermediate (1-3yr)/Advanced (3yr+)
6. Injuries to avoid → options: None/Shoulder/Knee/Lower Back/Wrist (skippable)
7. Muscles to focus → options: Chest/Back/Shoulders/Arms/Legs/Glutes/Core/No preference (skippable)

Items 1-5 are required. Items 6-7 are optional — if skipped, design without restrictions.

Design rules:
- ONLY use exercises from the list below with their exact exercise_id
- Specify day_indices for each routine in the cycle
- cycle_length includes rest days

Exercise list (format: id|name|zh_name|muscle_group):
${exerciseLines}

While asking output (multi_select defaults to false):
{"action":"ask","message":"question","options":["opt1","opt2"],"multi_select":false}

When generating output:
{"action":"generate_routine","message":"encouraging summary","cycle_length":7,"routines":[{"name":"Push Day","name_zh_tw":"推日","day_indices":[1,4],"exercises":[{"exercise_id":"uuid","exercise_name":"Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`
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

    // 找第一個 { 到最後一個 }
    const startIdx = rawText.indexOf('{')
    const endIdx = rawText.lastIndexOf('}')

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      try {
        const parsed = JSON.parse(rawText.slice(startIdx, endIdx + 1))
        if (parsed.action && parsed.message) {
          return NextResponse.json(parsed)
        }
      } catch {
        // JSON 解析失敗
      }
    }

    // fallback
    const zh = language === 'zh-TW'
    return NextResponse.json({
      action: 'ask',
      message: zh ? '抱歉，請再說一次。' : 'Sorry, could you repeat that?',
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