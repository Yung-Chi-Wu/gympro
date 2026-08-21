import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { RecommendationPanel } from '@/components/RecommendationPanel'
import { TodayWorkoutCard } from '@/components/TodayWorkoutCard'
import { PeriodCheckInCard } from '@/components/PeriodCheckInCard'
import { OnboardingModal } from '@/components/OnboardingModal'
import { PwaInstallBanner } from '@/components/PwaInstallBanner'
import type { ExerciseOption } from '@/components/log-types'

export interface TodayExercise {
  exerciseId: string
  name: string
  muscleGroup: string
  plannedRowId: string | null
  loggedSets: { id: string; reps: number; weightKg: number }[]
}

interface RoutineExerciseRow {
  exercise_id: string
  order_index: number
  exercises: { name: string; name_zh_tw: string | null; muscle_group: string } | null
}

interface PlannedExerciseRow {
  id: string
  exercise_id: string
  exercises: { name: string; name_zh_tw: string | null; muscle_group: string } | null
}

interface WorkoutSetRow {
  id: string
  exercise_id: string
  reps: number
  weight_kg: number
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const t = await getTranslations('dashboard')
  const tReport = await getTranslations('report')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, timezone, language, onboarding_completed')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: latestMetricData } = await supabase
    .from('body_metrics')
    .select('weight_kg')
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const greetingName = profile?.display_name || user.email
  const timezone = profile?.timezone || 'UTC'
  const language = profile?.language || 'en'
  const latestWeightKg = latestMetricData?.weight_kg ?? null
  const onboardingCompleted = profile?.onboarding_completed ?? false

  const todayParts = getLocalDateParts(timezone)
  const { startOfDay, endOfDay } = getTodayRangeUtc(todayParts, timezone)

  const { data: cycle } = await supabase
    .from('training_cycles')
    .select('id, cycle_length, start_date')
    .eq('user_id', user.id)
    .maybeSingle()

  const hasCycle = !!cycle
  let dayIndex = 0
  let routineIdForToday: string | null = null
  let isRestDay = false

  if (cycle) {
    const daysSinceStart = daysBetween(cycle.start_date, todayParts)
    dayIndex =
      (((daysSinceStart % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1

    const { data: cycleDay } = await supabase
      .from('cycle_days')
      .select('routine_id')
      .eq('training_cycle_id', cycle.id)
      .eq('day_index', dayIndex)
      .maybeSingle()

    routineIdForToday = cycleDay?.routine_id ?? null
    isRestDay = routineIdForToday === null
  }

  const { data: existingWorkout } = await supabase
    .from('workouts')
    .select('id')
    .eq('user_id', user.id)
    .gte('performed_at', startOfDay)
    .lte('performed_at', endOfDay)
    .order('performed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let todayExercises: TodayExercise[] = []

  if (existingWorkout) {
    const { data: planned } = await supabase
      .from('workout_planned_exercises')
      .select('id, exercise_id, exercises ( name, name_zh_tw, muscle_group )')
      .eq('workout_id', existingWorkout.id)

    const { data: sets } = await supabase
      .from('workout_sets')
      .select('id, exercise_id, reps, weight_kg')
      .eq('workout_id', existingWorkout.id)

    todayExercises = ((planned as PlannedExerciseRow[]) ?? []).map((p) => ({
      exerciseId: p.exercise_id,
      name: language === 'zh-TW' && p.exercises?.name_zh_tw
        ? p.exercises.name_zh_tw
        : p.exercises?.name ?? 'Unknown exercise',
      muscleGroup: p.exercises?.muscle_group ?? 'other',
      plannedRowId: p.id,
      loggedSets: ((sets as WorkoutSetRow[]) ?? [])
        .filter((s) => s.exercise_id === p.exercise_id)
        .map((s) => ({ id: s.id, reps: s.reps, weightKg: s.weight_kg })),
    }))
  } else if (routineIdForToday) {
    const { data: routineExercises } = await supabase
      .from('routine_exercises')
      .select('exercise_id, order_index, exercises ( name, name_zh_tw, muscle_group )')
      .eq('routine_id', routineIdForToday)
      .order('order_index')

    todayExercises = ((routineExercises as RoutineExerciseRow[]) ?? []).map((re) => ({
      exerciseId: re.exercise_id,
      name: language === 'zh-TW' && re.exercises?.name_zh_tw
        ? re.exercises.name_zh_tw
        : re.exercises?.name ?? 'Unknown exercise',
      muscleGroup: re.exercises?.muscle_group ?? 'other',
      plannedRowId: null,
      loggedSets: [],
    }))
  }

  const { data: allExercises } = await supabase
    .from('exercises')
    .select('id, name, name_zh_tw, muscle_group, equipment')
    .order('name')

  return (
    <div className="py-8 space-y-6">
      {!onboardingCompleted && (
        <OnboardingModal userId={user.id} language={language} />
      )}
      <PwaInstallBanner language={language} />

      <h1 className="text-3xl font-bold uppercase tracking-wide">
        {t('welcome')}{greetingName}
      </h1>

      <TodayWorkoutCard
        userId={user.id}
        initialWorkoutId={existingWorkout?.id ?? null}
        routineIdForToday={routineIdForToday}
        isRestDay={isRestDay}
        hasCycle={hasCycle}
        dayIndex={dayIndex}
        cycleLength={cycle?.cycle_length ?? 0}
        initialExercises={todayExercises}
        allExercises={(allExercises ?? []) as ExerciseOption[]}
        language={language}
      />

      <PeriodCheckInCard
        language={language}
        latestWeightKg={latestWeightKg}
      />

      <div className="space-y-3">
        <h2 className="text-xl font-bold uppercase tracking-wide border-b border-ink/10 pb-3">
          {tReport('sectionTitle')}
        </h2>
        <RecommendationPanel userId={user.id} language={language} />
      </div>
    </div>
  )
}

interface DateParts {
  year: number
  month: number
  day: number
}

function getLocalDateParts(timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date())) {
    parts[part.type] = part.value
  }
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) }
}

function daysBetween(startDateIso: string, today: DateParts): number {
  const start = new Date(`${startDateIso}T00:00:00Z`)
  const todayUtc = new Date(Date.UTC(today.year, today.month - 1, today.day))
  return Math.floor((todayUtc.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

function getTodayRangeUtc(
  today: DateParts,
  timeZone: string
): { startOfDay: string; endOfDay: string } {
  const reference = new Date(Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0))
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  })
  const offsetPart = tzFormatter.formatToParts(reference).find((p) => p.type === 'timeZoneName')
  const offsetMinutes = parseUtcOffsetMinutes(offsetPart?.value ?? 'GMT+0')
  const startOfDayUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 0, 0, 0) - offsetMinutes * 60_000
  )
  const endOfDayUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 23, 59, 59, 999) - offsetMinutes * 60_000
  )
  return { startOfDay: startOfDayUtc.toISOString(), endOfDay: endOfDayUtc.toISOString() }
}

function parseUtcOffsetMinutes(offsetLabel: string): number {
  const match = offsetLabel.match(/GMT([+-])(\d+)(?::(\d+))?/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? 0)
  return sign * (hours * 60 + minutes)
}