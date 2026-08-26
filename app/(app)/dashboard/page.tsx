import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { RecommendationPanel } from '@/components/RecommendationPanel'
import { TodayWorkoutCard } from '@/components/TodayWorkoutCard'
import { PeriodCheckInCard } from '@/components/PeriodCheckInCard'
import { OnboardingGuard } from '@/components/OnboardingGuard'
import type { ExerciseOption } from '@/components/log-types'
import type { WeightUnit } from '@/lib/weight-unit'

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

  const [t, tReport] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('report'),
  ])

  const [profileResult, latestMetricResult, cycleResult, allExercisesResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('display_name, timezone, language, onboarding_completed, weight_unit')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('body_metrics')
      .select('weight_kg')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('training_cycles')
      .select('id, cycle_length, start_date')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('exercises')
      .select('id, name, name_zh_tw, muscle_group, equipment')
      .order('name'),
  ])

  const profile = profileResult.data
  const latestMetricData = latestMetricResult.data
  const cycle = cycleResult.data

  const language = await getEffectiveLanguage(profile?.language)
  const greetingName = profile?.display_name || user.email
  const timezone = profile?.timezone || 'UTC'
  const latestWeightKg = latestMetricData?.weight_kg ?? null
  const onboardingCompleted = profile?.onboarding_completed ?? false
  const weightUnit = (profile?.weight_unit as WeightUnit) ?? 'kg'

  const hasCycle = !!cycle
  const todayParts = getLocalDateParts(timezone)
  const { startOfDay, endOfDay } = getTodayRangeUtc(todayParts, timezone)

  let dayIndex = 0
  let routineIdForToday: string | null = null
  let isRestDay = false

  const [cycleDayResult, existingWorkoutResult] = await Promise.all([
    cycle
      ? (() => {
        const daysSinceStart = daysBetween(cycle.start_date, todayParts)
        const idx =
          (((daysSinceStart % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1
        dayIndex = idx
        return supabase
          .from('cycle_days')
          .select('routine_id')
          .eq('training_cycle_id', cycle.id)
          .eq('day_index', idx)
          .maybeSingle()
      })()
      : Promise.resolve({ data: null }),
    supabase
      .from('workouts')
      .select('id')
      .eq('user_id', user.id)
      .gte('performed_at', startOfDay)
      .lte('performed_at', endOfDay)
      .order('performed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  routineIdForToday = cycleDayResult.data?.routine_id ?? null
  isRestDay = hasCycle && routineIdForToday === null
  const existingWorkout = existingWorkoutResult.data

  // 查今天課表名稱
  let routineName: string | null = null
  if (routineIdForToday) {
    const { data: routineData } = await supabase
      .from('routines')
      .select('name')
      .eq('id', routineIdForToday)
      .maybeSingle()
    routineName = routineData?.name ?? null
  }

  let todayExercises: TodayExercise[] = []

  if (existingWorkout) {
    const [plannedResult, setsResult] = await Promise.all([
      supabase
        .from('workout_planned_exercises')
        .select('id, exercise_id, exercises ( name, name_zh_tw, muscle_group )')
        .eq('workout_id', existingWorkout.id),
      supabase
        .from('workout_sets')
        .select('id, exercise_id, reps, weight_kg')
        .eq('workout_id', existingWorkout.id),
    ])

    const planned = (plannedResult.data as PlannedExerciseRow[]) ?? []
    const sets = (setsResult.data as WorkoutSetRow[]) ?? []

    todayExercises = planned.map((p) => ({
      exerciseId: p.exercise_id,
      name: language === 'zh-TW' && p.exercises?.name_zh_tw
        ? p.exercises.name_zh_tw
        : p.exercises?.name ?? 'Unknown exercise',
      muscleGroup: p.exercises?.muscle_group ?? 'other',
      plannedRowId: p.id,
      loggedSets: sets
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

  return (
    <div className="py-8 space-y-6">
      <OnboardingGuard
        userId={user.id}
        language={language}
        serverCompleted={onboardingCompleted}
      />

      <h1 className="text-3xl font-bold uppercase tracking-wide">
        {t('welcome')}
        <span className="block truncate">{greetingName}</span>
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-6 items-start">

        {/* 左欄：今天 + 桌面版 AI 報告 */}
        <div className="space-y-6">
          <TodayWorkoutCard
            userId={user.id}
            initialWorkoutId={existingWorkout?.id ?? null}
            routineIdForToday={routineIdForToday}
            isRestDay={isRestDay}
            hasCycle={hasCycle}
            dayIndex={dayIndex}
            cycleLength={cycle?.cycle_length ?? 0}
            initialExercises={todayExercises}
            allExercises={(allExercisesResult.data ?? []) as ExerciseOption[]}
            language={language}
            weightUnit={weightUnit}
            routineName={routineName}
          />

          {/* 桌面版才顯示 AI 報告 */}
          <div className="hidden sm:block space-y-3">
            <h2 className="text-lg font-bold uppercase tracking-wide border-b border-ink/10 pb-2">
              {tReport('sectionTitle')}
            </h2>
            <RecommendationPanel userId={user.id} language={language} />
          </div>
        </div>

        {/* 右欄：打卡 + 手機版 AI 報告 */}
        <div className="space-y-6">
          <PeriodCheckInCard
            language={language}
            latestWeightKg={latestWeightKg}
            weightUnit={weightUnit}
          />

          {/* 手機版才顯示 AI 報告（打卡下面） */}
          <div className="block sm:hidden space-y-3">
            <h2 className="text-lg font-bold uppercase tracking-wide border-b border-ink/10 pb-2">
              {tReport('sectionTitle')}
            </h2>
            <RecommendationPanel userId={user.id} language={language} />
          </div>
        </div>
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