import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RecommendationPanel } from '@/components/RecommendationPanel'
import { ReminderBanner } from '@/components/ReminderBanner'
import { TodayWorkoutCard } from '@/components/TodayWorkoutCard'
import { PeriodCheckInCard } from '@/components/PeriodCheckInCard'
import type { ExerciseOption } from '@/components/log-types'

const WEIGHT_REMINDER_DAYS = 7
const HEIGHT_REMINDER_DAYS = 30

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
  exercises: { name: string; muscle_group: string } | null
}

interface PlannedExerciseRow {
  id: string
  exercise_id: string
  exercises: { name: string; muscle_group: string } | null
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

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, height_updated_at, timezone')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: latestMetric } = await supabase
    .from('body_metrics')
    .select('recorded_at')
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const needsWeightLog = isOlderThanDays(latestMetric?.recorded_at ?? null, WEIGHT_REMINDER_DAYS)
  const needsHeightConfirm = isOlderThanDays(profile?.height_updated_at ?? null, HEIGHT_REMINDER_DAYS)
  const greetingName = profile?.display_name || user.email
  const timezone = profile?.timezone || 'UTC'

  // ---------- Does this user even have a training cycle? ----------
  const { data: cycle } = await supabase
    .from('training_cycles')
    .select('id, cycle_length, start_date')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!cycle) {
    // Regular (non-Pro) user: unchanged experience.
    return (
      <div className="p-8 space-y-6">
        <h1 className="text-3xl font-bold uppercase tracking-wide">
          Welcome back, {greetingName}
        </h1>
        <div className="flex gap-4">
          <a href="/log" className="text-sm underline">
            Log today's workout
          </a>
          <a href="/history" className="text-sm underline">
            View training history
          </a>
        </div>
        <ReminderBanner
          userId={user.id}
          needsWeightLog={needsWeightLog}
          needsHeightConfirm={needsHeightConfirm}
        />
        <PeriodCheckInCard />
        <RecommendationPanel userId={user.id} />
      </div>
    )
  }

  // ---------- Which day of the cycle is "today", in the user's own timezone ----------
  const todayParts = getLocalDateParts(timezone)
  const daysSinceStart = daysBetween(cycle.start_date, todayParts)
  const dayIndex = (((daysSinceStart % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1

  const { data: cycleDay } = await supabase
    .from('cycle_days')
    .select('routine_id')
    .eq('training_cycle_id', cycle.id)
    .eq('day_index', dayIndex)
    .maybeSingle()

  const routineIdForToday = cycleDay?.routine_id ?? null
  const isRestDay = routineIdForToday === null

  // ---------- Does today's workout already exist (i.e. did we already interact today)? ----------
  const { startOfDay, endOfDay } = getTodayRangeUtc(todayParts, timezone)

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
    // Already interacted today — use the real, persisted planned list,
    // which already reflects any removals/additions made earlier today.
    const { data: planned } = await supabase
      .from('workout_planned_exercises')
      .select('id, exercise_id, exercises ( name, muscle_group )')
      .eq('workout_id', existingWorkout.id)

    const { data: sets } = await supabase
      .from('workout_sets')
      .select('id, exercise_id, reps, weight_kg')
      .eq('workout_id', existingWorkout.id)

    todayExercises = ((planned as PlannedExerciseRow[]) ?? []).map((p) => ({
      exerciseId: p.exercise_id,
      name: p.exercises?.name ?? 'Unknown exercise',
      muscleGroup: p.exercises?.muscle_group ?? 'other',
      plannedRowId: p.id,
      loggedSets: ((sets as WorkoutSetRow[]) ?? [])
        .filter((s) => s.exercise_id === p.exercise_id)
        .map((s) => ({ id: s.id, reps: s.reps, weightKg: s.weight_kg })),
    }))
  } else if (routineIdForToday) {
    // Nothing written yet — derive the suggestion straight from the routine template.
    const { data: routineExercises } = await supabase
      .from('routine_exercises')
      .select('exercise_id, order_index, exercises ( name, muscle_group )')
      .eq('routine_id', routineIdForToday)
      .order('order_index')

    todayExercises = ((routineExercises as RoutineExerciseRow[]) ?? []).map((re) => ({
      exerciseId: re.exercise_id,
      name: re.exercises?.name ?? 'Unknown exercise',
      muscleGroup: re.exercises?.muscle_group ?? 'other',
      plannedRowId: null,
      loggedSets: [],
    }))
  }

  const { data: allExercises } = await supabase
    .from('exercises')
    .select('id, name, muscle_group, equipment')
    .order('name')

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold uppercase tracking-wide">
        Welcome back, {greetingName}
      </h1>
      <a href="/history" className="text-sm underline">
        View training history
      </a>

      <ReminderBanner
        userId={user.id}
        needsWeightLog={needsWeightLog}
        needsHeightConfirm={needsHeightConfirm}
      />

      <PeriodCheckInCard />

      <TodayWorkoutCard
        userId={user.id}
        initialWorkoutId={existingWorkout?.id ?? null}
        routineIdForToday={routineIdForToday}
        isRestDay={isRestDay}
        dayIndex={dayIndex}
        cycleLength={cycle.cycle_length}
        initialExercises={todayExercises}
        allExercises={(allExercises ?? []) as ExerciseOption[]}
      />

      <RecommendationPanel userId={user.id} />
    </div>
  )
}

function isOlderThanDays(dateString: string | null, days: number): boolean {
  if (!dateString) return true
  const recorded = new Date(dateString).getTime()
  const now = Date.now()
  const diffDays = (now - recorded) / (1000 * 60 * 60 * 24)
  return diffDays >= days
}

// ---------- Timezone-aware date helpers ----------
// Mirrors the technique used in lambda/weekly-scheduler/src/date.ts: the
// server's own clock is not the user's clock, so "today" has to be derived
// from the user's configured timezone, not the runtime's system time.

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