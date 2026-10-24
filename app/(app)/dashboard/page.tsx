import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { createClient } from '@/lib/supabase/server'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { RecommendationPanel } from '@/components/RecommendationPanel'
import { TodayWorkoutCard } from '@/components/TodayWorkoutCard'
import { PeriodNoteCard } from '@/components/PeriodNoteCard'
import { OnboardingGuard } from '@/components/OnboardingGuard'
import type { ExerciseOption } from '@/components/log-types'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { currentPeriod, daysBetween, localDate } from '@/lib/periods'
import { localDayToUtcRange, timeZoneOf } from '@/lib/time-zone'
import { loadTodayWorkout } from '@/lib/today-workout'
import { recentExerciseIds, withRecent } from '@/lib/recent-exercises'
import { loadLatestReport } from '@/lib/report/latest'
import { ServerTimingMark } from '@/components/ServerTimingMark'
import { ReadYourWrites } from '@/components/ReadYourWrites'

// 今天. Its reads go out in two rounds. Who is signed in is checked here (no network). Then
// everything that needs only the user, and as soon as the profile and the cycle are in, what needs
// the user's day (loadDay): today's workout with last time's sets for today's routine, the notes
// and the weigh-ins. An exercise outside today's routine takes one more round
// (lib/today-workout.ts). One query after another was ten rounds.
export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const [day, allExercisesResult, recentIds, latestReport, t, tReport, tPeriod] = await Promise.all([
    loadDay(supabase, user.id),
    supabase
      .from('exercises')
      .select('id, name, name_zh_tw, muscle_group, equipment, log_type, per_side')
      .order('name'),
    recentExerciseIds(supabase, user.id),
    loadLatestReport(supabase, user.id),
    getTranslations('dashboard'),
    getTranslations('report'),
    getTranslations('periodLog'),
  ])
  const { profile, cycle, language, period, todayIso, todayRange, dayIndex, routineIdForToday, routineName, today, periodNote } = day

  const greetingName = profile?.display_name || user.email || ''
  const onboardingCompleted = profile?.onboarding_completed ?? false
  const weightUnit = (profile?.weight_unit as WeightUnit) ?? 'kg'
  const distanceUnit: DistanceUnit = profile?.distance_unit === 'mi' ? 'mi' : 'km'

  const hasCycle = !!cycle
  const isRestDay = hasCycle && routineIdForToday === null

  return (
    <div className="space-y-5 md:space-y-6">
      <ServerTimingMark />
      <ReadYourWrites />
      <OnboardingGuard
        userId={user.id}
        language={language}
        serverCompleted={onboardingCompleted}
      />

      {/* One line on the phone, under the top bar that already says 今天 */}
      <h1 className="truncate text-lg font-semibold text-muted md:text-3xl md:font-bold md:text-ink">
        {t('welcome', { name: greetingName })}
      </h1>

      {/* Today's log, then the report: side by side once the page is wide enough */}
      <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[3fr_2fr] @4xl:gap-6">
        <TodayWorkoutCard
          key={`${todayIso}:${today.workoutId ?? 'no-workout'}`}
          userId={user.id}
          initialWorkoutId={today.workoutId}
          todayRange={todayRange}
          routineIdForToday={routineIdForToday}
          isRestDay={isRestDay}
          hasCycle={hasCycle}
          dayIndex={dayIndex}
          cycleLength={cycle?.cycle_length ?? 0}
          initialExercises={today.exercises}
          allExercises={withRecent((allExercisesResult.data ?? []) as ExerciseOption[], recentIds)}
          language={language}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          routineName={routineName}
          initialDayNote={day.dayNote}
          initialWeightKg={day.todayWeightKg}
          lastWeightKg={day.lastWeightKg}
        />

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">{tReport('sectionTitle')}</h2>
            {period && (
              <p className="text-[13px] text-muted">
                {tPeriod('reportSchedule', { end: formatPeriodDate(period.periodEnd, language) })}
              </p>
            )}
          </div>
          {period && periodNote && <PeriodNoteCard initialNote={periodNote} />}
          <RecommendationPanel userId={user.id} initial={latestReport} language={language} weightUnit={weightUnit} distanceUnit={distanceUnit} />
        </section>
      </div>
    </div>
  )
}

// The user's day, by their time zone and cycle, and what's logged in it. It waits only for the
// profile and the cycle, so its round goes out while the page's other first reads are still out.
async function loadDay(supabase: SupabaseClient<Database>, userId: string) {
  const [{ profile }, cycleResult] = await Promise.all([
    getFrameProfile(),
    supabase
      .from('training_cycles')
      // Each routine's exercises too: last time's sets for today's go out with today's workout
      .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id, routines ( name, routine_exercises ( exercise_id ) ) )')
      .eq('user_id', userId)
      .maybeSingle(),
  ])
  const cycle = cycleResult.data

  const language = await getEffectiveLanguage(profile)
  const timezone = timeZoneOf(profile?.timezone)
  const period = currentPeriod(
    timezone,
    cycle ? { cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null
  )
  const todayIso = localDate(timezone, new Date())
  const todayRange = localDayToUtcRange(todayIso, timezone)

  const dayIndex = cycle
    ? (((daysBetween(cycle.start_date, todayIso) % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1
    : 0
  const cycleDay = cycle?.cycle_days.find((d) => d.day_index === dayIndex)
  const routineIdForToday = cycleDay?.routine_id ?? null

  const [periodNoteResult, dayNoteResult, todayWeightResult, lastWeightResult, today] = await Promise.all([
    period
      ? supabase
        .from('period_notes')
        .select('note')
        .eq('user_id', userId)
        .eq('period_start', period.periodStart)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('day_notes')
      .select('note')
      .eq('user_id', userId)
      .eq('note_date', todayIso)
      .maybeSingle(),
    // Today's weigh-in, and the one before today as the weight box's hint
    supabase
      .from('body_metrics')
      .select('weight_kg')
      .eq('user_id', userId)
      .gte('recorded_at', todayRange.start)
      .lte('recorded_at', todayRange.end)
      .not('weight_kg', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('body_metrics')
      .select('weight_kg')
      .eq('user_id', userId)
      .lt('recorded_at', todayRange.start)
      .not('weight_kg', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadTodayWorkout(supabase, {
      userId,
      range: todayRange,
      routineId: routineIdForToday,
      routineExerciseIds: cycleDay?.routines?.routine_exercises.map((re) => re.exercise_id) ?? [],
      language,
    }),
  ])

  return {
    profile,
    cycle,
    language,
    period,
    todayIso,
    todayRange,
    dayIndex,
    routineIdForToday,
    routineName: cycleDay?.routines?.name ?? null,
    today,
    periodNote: periodNoteResult.data?.note ?? '',
    dayNote: dayNoteResult.data?.note ?? '',
    todayWeightKg: todayWeightResult.data?.weight_kg ?? null,
    lastWeightKg: lastWeightResult.data?.weight_kg ?? null,
  }
}

function formatPeriodDate(dateIso: string, language: string): string {
  // Noon UTC keeps the calendar date the same in every time zone
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString(language === 'zh-TW' ? 'zh-TW' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  })
}
