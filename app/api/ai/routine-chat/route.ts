import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { takeAiSlot } from '@/lib/ai/model-client'
import { errorText } from '@/lib/ai/trace'
import { traceAfterResponse } from '@/lib/ai/trace-after'
import { parseChatRequest } from '@/lib/coach-g'

// 固定問題定義
const QUESTIONS = {
  zh: [
    {
      step: 1,
      question: '你每週能訓練幾天？',
      options: ['2天', '3天', '4天', '5天', '6天', '7天'],
      multi_select: false,
      skippable: false,
    },
    {
      step: 2,
      question: '每次訓練大概多久？',
      options: ['30分鐘', '45分鐘', '60分鐘', '90分鐘以上'],
      multi_select: false,
      skippable: false,
    },
    {
      step: 3,
      question: '你有哪些器材可以用？（可以多選）',
      options: ['槓鈴', '啞鈴', '健身房器械', '纜繩/滑輪', '徒手訓練'],
      multi_select: true,
      skippable: false,
    },
    {
      step: 4,
      question: '你的主要訓練目標是什麼？（可以多選）',
      options: ['增肌', '增強力量', '減脂', '維持體能'],
      multi_select: true,
      skippable: false,
    },
    {
      step: 5,
      question: '你練多久了？',
      options: ['新手（不到1年）', '中階（1-3年）', '進階（3年以上）'],
      multi_select: false,
      skippable: false,
    },
    {
      step: 6,
      question: '有沒有受傷或要避開的部位？',
      options: ['脖子', '肩膀', '手肘', '手腕', '下背', '髖部', '膝蓋', '腳踝'],
      multi_select: false,
      skippable: true,
    },
    {
      step: 7,
      question: '最後，還有什麼想告訴我的嗎？例如：不想做某些動作、想加強某個部位、或任何其他需求。',
      options: [],
      multi_select: false,
      skippable: true,
    },
  ],
  en: [
    {
      step: 1,
      question: 'How many days per week can you train?',
      options: ['2 days', '3 days', '4 days', '5 days', '6 days', '7 days'],
      multi_select: false,
      skippable: false,
    },
    {
      step: 2,
      question: 'How long is each training session?',
      options: ['30 min', '45 min', '60 min', '90+ min'],
      multi_select: false,
      skippable: false,
    },
    {
      step: 3,
      question: 'What equipment do you have access to? (Select all that apply)',
      options: ['Barbell', 'Dumbbell', 'Gym Machines', 'Cable Machine', 'Bodyweight'],
      multi_select: true,
      skippable: false,
    },
    {
      step: 4,
      question: "What's your primary training goal? (Select all that apply)",
      options: ['Build Muscle', 'Increase Strength', 'Lose Fat', 'Stay Fit'],
      multi_select: true,
      skippable: false,
    },
    {
      step: 5,
      question: "What's your experience level?",
      options: ['Beginner (<1yr)', 'Intermediate (1-3yr)', 'Advanced (3yr+)'],
      multi_select: false,
      skippable: false,
    },
    {
      step: 6,
      question: 'Any injuries or areas to avoid?',
      options: ['Neck', 'Shoulder', 'Elbow', 'Wrist', 'Lower Back', 'Hip', 'Knee', 'Ankle'],
      multi_select: false,
      skippable: true,
    },
    {
      step: 7,
      question: 'Last question — anything else you want me to know? For example: exercises you dislike, muscle groups to prioritize, or any other preferences.',
      options: [],
      multi_select: false,
      skippable: true,
    },
  ],
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // A step from 0 to 7 and short answers (lib/coach-g.ts); anything else is refused, not crashed on
  const parsed = parseChatRequest(await request.json().catch(() => null))
  if (!parsed) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const { step: currentStep, answer: userAnswer, zh, collected } = parsed
  const questions = zh ? QUESTIONS.zh : QUESTIONS.en

  // Step 0: 開場問候 + 問第一題
  if (currentStep === 0) {
    const q = questions[0]
    const greeting = zh
      ? '嗨！我是 Coach G 💪 讓我來幫你設計一套專屬課表！先問你幾個問題。'
      : "Hey! I'm Coach G 💪 Let's build your perfect routine! Just a few quick questions."

    return NextResponse.json({
      action: 'ask',
      message: greeting,
      question: q.question,
      options: q.options,
      multi_select: q.multi_select,
      skippable: q.skippable,
      nextStep: 1,
    })
  }

  // 用 AI 生成對使用者答案的友善回應 + 下一題
  const nextStep = currentStep + 1
  const nextQ = nextStep <= 7 ? questions[nextStep - 1] : null

  const systemPrompt = zh
    ? `你是 Coach G，友善的健身教練。你的工作是：
1. 對使用者剛才的回答給一個簡短、鼓勵的回應（1-2句話）
2. 只輸出 JSON，不輸出其他文字

輸出格式：
{"action":"ask","message":"你的鼓勵回應"}`
    : `You are Coach G, a friendly fitness coach. Your job is:
1. Give a brief, encouraging response to the user's answer (1-2 sentences)
2. Output ONLY JSON, no other text

Output format:
{"action":"ask","message":"your encouraging response"}`

  const userContent = zh
    ? `使用者對「${questions[currentStep - 1].question}」的回答是：「${userAnswer}」`
    : `User answered "${userAnswer}" to the question: "${questions[currentStep - 1].question}"`

  // One or two sentences back: the fast model, so the next question comes at once
  const model = 'claude-haiku-4-5-20251001'
  const traceInput = { step: currentStep, system: systemPrompt, user: userContent }
  // Without the model's line: the next question, or the plan, comes all the same
  const fallback = () => {
    const fallbackMsg = zh ? '好的！' : 'Got it!'
    if (nextQ) {
      return NextResponse.json({
        action: 'ask',
        message: fallbackMsg,
        question: nextQ.question,
        options: nextQ.options,
        multi_select: nextQ.multi_select,
        skippable: nextQ.skippable,
        nextStep,
      })
    }
    return NextResponse.json({
      action: 'ready_to_generate',
      message: fallbackMsg,
      collected,
    })
  }
  // Past the spend limits (lib/ai/spend-limits.ts), Coach G goes on without the model, and so it
  // does when the model is slow: the line is a nicety, and a stalled call would hold the slot
  const { slot } = await takeAiSlot(user.id, { timeout: 10_000, maxRetries: 0 })
  if (!slot) return fallback()
  const started = Date.now()
  try {
    const response = await slot.client.messages.create({
      model,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    })

    const rawText = response.content[0].type === 'text'
      ? response.content[0].text.trim() : ''

    const startIdx = rawText.indexOf('{')
    const endIdx = rawText.lastIndexOf('}')

    let message = zh ? '好的！' : 'Got it!'
    if (startIdx !== -1 && endIdx !== -1) {
      try {
        const parsed = JSON.parse(rawText.slice(startIdx, endIdx + 1))
        if (parsed.message) message = parsed.message
      } catch { /* 用預設訊息 */ }
    }
    traceAfterResponse({
      userId: user.id, feature: 'coach_chat', model, servedModel: response.model, status: 'ok',
      latencyMs: Date.now() - started, usage: [response.usage], input: traceInput, output: { text: rawText, message },
    }, slot)

    // 如果還有下一題
    if (nextQ) {
      return NextResponse.json({
        action: 'ask',
        message,
        question: nextQ.question,
        options: nextQ.options,
        multi_select: nextQ.multi_select,
        skippable: nextQ.skippable,
        nextStep,
      })
    }

    // 所有題都問完
    return NextResponse.json({
      action: 'ready_to_generate',
      message,
      collected,
    })

  } catch (err) {
    console.error('Coach G chat error:', errorText(err))
    traceAfterResponse({
      userId: user.id, feature: 'coach_chat', model, status: 'error', error: errorText(err),
      latencyMs: Date.now() - started, usage: [], input: traceInput,
    }, slot)
    return fallback()
  }
}