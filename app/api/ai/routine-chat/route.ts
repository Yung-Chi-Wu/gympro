import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const SYSTEM_PROMPT = `You are Coach G, an expert fitness coach and program designer for GymPro app.

Your job is to design a personalized training routine through friendly conversation.
Ask ONE question at a time. Keep messages short and encouraging.

You must collect these details (in order):
1. Days per week available
2. Session duration
3. Equipment available (can be multiple: barbell, dumbbells, machines, cables, bodyweight)
4. Primary goal
5. Training experience level
6. Any injuries or areas to avoid
7. Muscle groups to prioritize (optional)
8. Any other preferences (optional - ask this last)

Rules:
- Always provide clickable options with your question (3-6 options max)
- Also accept free text answers
- Be encouraging and professional
- Reference previous answers to show you're listening
- When you have enough info (at minimum: days, equipment, goal, level), generate the routine

CRITICAL: You must ONLY output valid JSON. Never output plain text. Never add explanation outside the JSON.

When still gathering info output ONLY this JSON:
{"action":"ask","message":"your question here","options":["Option 1","Option 2","Option 3"]}

When ready to generate output ONLY this JSON:
{"action":"generate_routine","message":"brief encouraging summary","routines":[{"name":"Push Day","name_zh_tw":"推日","exercises":[{"exercise_name":"Barbell Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`

const SYSTEM_PROMPT_ZH = `你是 Coach G，GymPro 的專業健身教練和課表設計師。

你的工作是透過友善的對話為使用者設計個人化訓練課表。
每次只問一個問題，回答要簡短且鼓勵性。

你必須依序收集這些資訊：
1. 每週可以訓練幾天
2. 每次訓練時長
3. 可用器材（可多選：槓鈴、啞鈴、健身房器械、纜繩/滑輪、徒手）
4. 主要訓練目標
5. 訓練程度
6. 有沒有受傷或要避開的部位
7. 特別想加強的部位（選填）
8. 其他偏好（選填，最後問）

規則：
- 每個問題都要提供可點選的選項（3-6個）
- 同時接受自由文字回答
- 語氣要專業且鼓勵
- 引用之前的回答表示你在認真聽
- 收集到足夠資訊後（至少：天數、器材、目標、程度）就生成課表

重要：只能輸出 JSON，絕對不能輸出純文字，不能在 JSON 外面加任何說明。

還在收集資訊時只輸出這個 JSON：
{"action":"ask","message":"你的問題","options":["選項1","選項2","選項3"]}

準備生成課表時只輸出這個 JSON：
{"action":"generate_routine","message":"簡短鼓勵的說明","routines":[{"name":"Push Day","name_zh_tw":"推日","exercises":[{"exercise_name":"Barbell Bench Press","exercise_name_zh_tw":"槓鈴臥推","muscle_group":"chest","target_sets":4,"target_reps":8}]}]}`

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages, language, trainingGoal } = await request.json()

  const systemPrompt = language === 'zh-TW' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT

  const contextNote = trainingGoal
    ? `\n\nUser's long-term training goal from their profile: "${trainingGoal}"`
    : ''

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt + contextNote,
      messages,
    })

    const rawText = response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : ''

    // 嘗試解析 JSON——找第一個 { 到最後一個 }
    const startIdx = rawText.indexOf('{')
    const endIdx = rawText.lastIndexOf('}')

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonStr = rawText.slice(startIdx, endIdx + 1)
      try {
        const parsed = JSON.parse(jsonStr)
        if (parsed.action && parsed.message) {
          return NextResponse.json(parsed)
        }
      } catch {
        // JSON 解析失敗，繼續
      }
    }

    // 解析失敗——回傳錯誤提示讓 AI 重試
    const zh = language === 'zh-TW'
    return NextResponse.json({
      action: 'ask',
      message: zh
        ? '抱歉，我剛才的回應出了點問題，請再說一次。'
        : 'Sorry, something went wrong with my response. Could you repeat that?',
      options: [],
    })

  } catch (err) {
    console.error('Coach G error:', err)
    return NextResponse.json({
      action: 'ask',
      message: language === 'zh-TW'
        ? '發生錯誤，請稍後再試。'
        : 'Something went wrong. Please try again.',
      options: [],
    }, { status: 500 })
  }
}