import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function buildChatPrompt(language: string, trainingGoal: string | null) {
  const zh = language === 'zh-TW'
  const goalNote = trainingGoal
    ? (zh ? `\n使用者長期目標：「${trainingGoal}」` : `\nUser's long-term goal: "${trainingGoal}"`)
    : ''

  if (zh) {
    return `你是 Coach G，GymPro 的健身教練。透過對話收集使用者的訓練資訊。${goalNote}

重要規則：
- 每次只問一個問題，附上選項
- 仔細讀對話歷史，絕對不重複問已經回答的問題
- 使用者可以點選項或自由打字，兩種都接受
- 問題 1-5 是必答，skippable 必須是 false，不能接受跳過
- 問題 6-7 是選填，skippable 必須是 true
- 如果使用者對必答題說「跳過」或「沒有」，溫和提醒這題必須回答，重新給選項
- 器材題（第3題）：如果使用者說沒有器材，引導選「徒手訓練」
- 收集完 1-5 後（6-7 無論有沒有回答），立刻輸出 ready_to_generate
- 只輸出 JSON，不輸出任何其他文字
- cycle_length 必須等於使用者指定的天數（例如使用者說 7 天，cycle_length 就是 7）
- AI 可以自己決定哪幾天練、哪幾天休息，但 cycle_length 不能改變
- 例如：使用者說 7 天，AI 可以安排週一到週五練、週六週日休息，但 cycle_length: 7

依序問這 7 個問題：
1. 一週訓練幾天？選項：[2天, 3天, 4天, 5天, 6天, 7天]（必答，接受自由輸入，skippable:false）
2. 每次訓練多久？選項：[30分鐘, 45分鐘, 60分鐘, 90分鐘以上]（必答，skippable:false）
3. 有哪些器材？選項：[槓鈴, 啞鈴, 健身房器械, 纜繩/滑輪, 徒手訓練]（必答，multi_select:true，skippable:false）
4. 主要目標？選項：[增肌, 增強力量, 減脂, 維持體能]（必答，multi_select:true，skippable:false）
5. 訓練程度？選項：[新手（不到1年）, 中階（1-3年）, 進階（3年以上）]（必答，skippable:false）
6. 有受傷要避開的部位嗎？選項：[肩膀, 膝蓋, 下背, 手腕]（選填，skippable:true）
7. 想特別加強哪個部位？選項：[胸, 背, 肩, 手臂, 腿, 臀, 核心]（選填，skippable:true）

問問題時輸出（skippable 預設 false）：
{"action":"ask","message":"問題內容","options":["選項1","選項2"],"multi_select":false,"skippable":false}

多選時加 "multi_select":true，選填題加 "skippable":true

收集完 1-5 後輸出：
{"action":"ready_to_generate","collected":{"days":"使用者回答","duration":"使用者回答","equipment":["器材1","器材2"],"goals":["目標1"],"level":"程度","injuries":"受傷部位或null","focus":"加強部位或null"}}`
  }

  return `You are Coach G, GymPro's fitness coach. Collect training info through conversation.${goalNote}

Critical rules:
- Ask ONE question at a time with options
- Read conversation history carefully — NEVER repeat answered questions
- Users can click options OR type freely — accept both
- Questions 1-5 are required, skippable must be false, do NOT accept skip answers
- Questions 6-7 are optional, skippable must be true
- If user tries to skip a required question, gently remind them it's required and re-show options
- For equipment (Q3): if user says no equipment, guide them to select "Bodyweight"
- After collecting 1-5 (regardless of 6-7 answers), immediately output ready_to_generate
- Output ONLY JSON, never plain text
- cycle_length MUST equal the number of days the user specified (e.g. user says 7 days → cycle_length: 7)
- AI decides which days to train and which to rest, but cycle_length cannot change
- Example: user says 7 days → AI can schedule training on days 1-5 and rest on days 6-7, but cycle_length: 7

Ask these 7 questions in order:
1. Days per week? Options: [2 days, 3 days, 4 days, 5 days, 6 days, 7 days] (required, accept free input, skippable:false)
2. Session duration? Options: [30 min, 45 min, 60 min, 90+ min] (required, skippable:false)
3. Equipment? Options: [Barbell, Dumbbell, Gym Machines, Cable Machine, Bodyweight] (required, multi_select:true, skippable:false)
4. Primary goal? Options: [Build Muscle, Increase Strength, Lose Fat, Stay Fit] (required, multi_select:true, skippable:false)
5. Experience level? Options: [Beginner (<1yr), Intermediate (1-3yr), Advanced (3yr+)] (required, skippable:false)
6. Any injuries to avoid? Options: [Shoulder, Knee, Lower Back, Wrist] (optional, skippable:true)
7. Muscle to focus on? Options: [Chest, Back, Shoulders, Arms, Legs, Glutes, Core] (optional, skippable:true)

When asking output:
{"action":"ask","message":"question","options":["opt1","opt2"],"multi_select":false,"skippable":false}

For multi-select add "multi_select":true, for optional questions add "skippable":true

After collecting 1-5 output:
{"action":"ready_to_generate","collected":{"days":"answer","duration":"answer","equipment":["equipment1","equipment2"],"goals":["goal1"],"level":"level","injuries":"injuries or null","focus":"focus or null"}}`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, language, trainingGoal } = await request.json()
  const systemPrompt = buildChatPrompt(language, trainingGoal)

  try {
    let parsed = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      })

      const rawText = response.content[0].type === 'text'
        ? response.content[0].text.trim() : ''

      const startIdx = rawText.indexOf('{')
      const endIdx = rawText.lastIndexOf('}')

      if (startIdx !== -1 && endIdx !== -1) {
        try {
          const candidate = JSON.parse(rawText.slice(startIdx, endIdx + 1))
          if (candidate.action) {
            parsed = candidate
            break
          }
        } catch { /* 繼續重試 */ }
      }
    }

    if (parsed) return NextResponse.json(parsed)

    const zh = language === 'zh-TW'
    return NextResponse.json({
      action: 'ask',
      message: zh ? '抱歉，請再說一次。' : 'Sorry, could you repeat that?',
      options: [],
      multi_select: false,
      skippable: false,
    })
  } catch (err) {
    console.error('Coach G chat error:', err)
    return NextResponse.json({ error: 'AI error' }, { status: 500 })
  }
}