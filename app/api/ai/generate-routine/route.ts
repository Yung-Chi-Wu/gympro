import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { errorText } from '@/lib/ai/trace'
import { traceAfterResponse } from '@/lib/ai/trace-after'
import { reportError } from '@/lib/report-error'
import { COACH_CYCLE_DAYS, parseGenerateRequest } from '@/lib/coach-g'
import { buildPlan, mergeReading, readAnswers, readingRequest, type Answers, type PlannerExercise } from '@/lib/coach-g-planner'

// Coach G's plan from the chat's answers (lib/coach-g-planner.ts). Code builds it; a small model
// reads the answers only when there is free text to read (the last question, or a typed
// answer), into fixed choices. Tapping options alone makes no model call.

// A short reading, so the fast model; one retry, and no long wait: without it the plan still comes
const READER_MODEL = 'claude-haiku-4-5-20251001'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, timeout: 20_000, maxRetries: 1 })

/** How the questions read to the model: the answers come in this order */
const QUESTIONS = ['Training days a week', 'Length of each session', 'Equipment available', 'Training goals', 'Experience', 'Injuries or areas to avoid', 'Anything else (exercises disliked, muscles to prioritise, other needs)']

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // The chat's answers, each short (lib/coach-g.ts); anything else is refused, not crashed on
    const info = parseGenerateRequest(await request.json().catch(() => null))
    if (!info) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    const { data, error: exercisesError } = await supabase
        .from('exercises')
        .select('id, name, name_zh_tw, muscle_group, equipment, primary_muscles, secondary_muscles, joint_load, stability_demand')
        .order('muscle_group')
        .order('name')
    if (exercisesError) {
        reportError('coach-g/generate', exercisesError, { userId: user.id, context: { step: 'exercises' } })
        return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
    }
    const exercises = (data ?? []) as PlannerExercise[]

    const answers: Answers = { days: info.days, duration: info.duration, equipment: info.equipment, goals: info.goals, level: info.level, injuries: info.injuries, notes: info.notes }
    const { preferences: byWords, needsModel } = readAnswers(answers)
    let preferences = byWords

    if (needsModel) {
        const ask = readingRequest(answers, QUESTIONS, exercises)
        const traceInput = { answers, byWords, system: ask.system, user: ask.user }
        const started = Date.now()
        try {
            const response = await client.messages.create({
                model: READER_MODEL,
                max_tokens: 512,
                system: ask.system,
                tools: [ask.tool],
                tool_choice: { type: 'tool', name: ask.tool.name },
                messages: [{ role: 'user', content: ask.user }],
            })
            const reading = response.content.find((b) => b.type === 'tool_use')?.input
            preferences = mergeReading(byWords, reading, ask.ids)
            traceAfterResponse({
                userId: user.id, feature: 'coach_routine', model: READER_MODEL, servedModel: response.model, status: 'ok',
                latencyMs: Date.now() - started, usage: [response.usage], input: traceInput, output: { reading, preferences },
            })
        } catch (err) {
            // The answers' own words still give a plan; the free text is what's missing
            console.error('Coach G reading failed:', errorText(err))
            traceAfterResponse({
                userId: user.id, feature: 'coach_routine', model: READER_MODEL, status: 'error', error: errorText(err),
                latencyMs: Date.now() - started, usage: [], input: traceInput,
            })
        }
    }

    const routines = buildPlan(preferences, exercises)
    if (!routines.length) {
        // The choices only, not the injuries or exercises the user named
        reportError('coach-g/generate', 'The planner built no routine', {
            userId: user.id, context: { days: preferences.days, minutes: preferences.minutes, equipment: preferences.equipment.join(','), library: exercises.length },
        })
        return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
    }
    return NextResponse.json({ action: 'generate_routine', message: '', cycle_length: COACH_CYCLE_DAYS, routines })
}
