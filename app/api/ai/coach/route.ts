import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { buildSystemPrompt } from '@/lib/ronnie/prompt'
import { createSupabaseRonnieData } from '@/lib/ronnie/data'
import { createRonnieExecutor } from '@/lib/ronnie/executor'
import { runRonnieTurn } from '@/lib/ronnie/agent'
import { localDateStr } from '@/lib/ronnie/time'

// Ronnie lives in lib/ronnie so the eval can run the same agent against fixture
// data; this route only authenticates and wires it to the user's Supabase data.

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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
    const userTimezone = profile?.timezone ?? 'America/New_York'

    const data = createSupabaseRonnieData(supabase, userId, userTimezone, cycle)

    let todayRoutineName: string | null = null
    if (cycle) {
        const routineId = await data.getTodayRoutineId()
        if (routineId) {
            todayRoutineName = await data.getRoutineName(routineId)
        }
    }

    const userContext = {
        displayName: profile?.display_name ?? null,
        goal: profile?.training_goal ?? null,
        todayRoutineName,
        weightUnit: profile?.weight_unit ?? 'kg',
        timezone: userTimezone,
        todayDate: localDateStr(new Date(), userTimezone),
    }

    const systemPrompt = buildSystemPrompt(language, userContext)
    const executor = createRonnieExecutor({ data, language, timeZone: userTimezone, todayRoutineName })

    try {
        const turn = await runRonnieTurn({ client, system: systemPrompt, messages, executor, language })
        return NextResponse.json({
            message: turn.message,
            reloadDashboard: turn.reloadDashboard,
        })
    } catch (err) {
        console.error('Ronnie error:', err)
        return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }
}
