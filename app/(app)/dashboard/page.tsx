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

// 今天. Its reads go out in rounds, each waiting only on the one before: who is signed in is
// checked here (no network); then everything that needs only the user, the cycle with all its
// days among it; then what needs their time zone and today's routine, today's workout among it
// (loadTodayWorkout adds a round for last time's sets). One query after another was ten rounds.
export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const [{ profile }, cycleResult, allExercisesResult, recentIds, latestReport, t, tReport, tPeriod] = await Promise.all([
    getFrameProfile(),
    supabase
      .from('training_cycles')
      .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id, routines ( name ) )')
      .eq('user_id', user.id)
      .maybeSingle(),
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

  const cycle = cycleResult.data

  const language = await getEffectiveLanguage(profile)
  const greetingName = profile?.display_name || user.email || ''
  const timezone = timeZoneOf(profile?.timezone)
  const onboardingCompleted = profile?.onboarding_completed ?? false
  const weightUnit = (profile?.weight_unit as WeightUnit) ?? 'kg'
  const distanceUnit: DistanceUnit = profile?.distance_unit === 'mi' ? 'mi' : 'km'

  const hasCycle = !!cycle
  const period = currentPeriod(
    timezone,
    cycle ? { cycleLength: cycle.cycle_length, startDate: cycle.start_date } : null
  )
  const todayIso = localDate(timezone, new Date())
  const { start: startOfDay, end: endOfDay } = localDayToUtcRange(todayIso, timezone)

  const dayIndex = cycle
    ? (((daysBetween(cycle.start_date, todayIso) % cycle.cycle_length) + cycle.cycle_length) % cycle.cycle_length) + 1
    : 0
  const cycleDay = cycle?.cycle_days.find((d) => d.day_index === dayIndex)
  const routineIdForToday = cycleDay?.routine_id ?? null
  const routineName = cycleDay?.routines?.name ?? null
  const isRestDay = hasCycle && routineIdForToday === null
  const todayRange = { start: startOfDay, end: endOfDay }

  const [periodNoteResult, dayNoteResult, todayWeightResult, lastWeightResult, today] = await Promise.all([
    period
      ? supabase
        .from('period_notes')
        .select('note')
        .eq('user_id', user.id)
        .eq('period_start', period.periodStart)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('day_notes')
      .select('note')
      .eq('user_id', user.id)
      .eq('note_date', todayIso)
      .maybeSingle(),
    // Today's weigh-in, and the one before today as the weight box's hint
    supabase
      .from('body_metrics')
      .select('weight_kg')
      .eq('user_id', user.id)
      .gte('recorded_at', startOfDay)
      .lte('recorded_at', endOfDay)
      .not('weight_kg', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('body_metrics')
      .select('weight_kg')
      .eq('user_id', user.id)
      .lt('recorded_at', startOfDay)
      .not('weight_kg', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadTodayWorkout(supabase, { userId: user.id, range: todayRange, routineId: routineIdForToday, language }),
  ])

  const periodNote = periodNoteResult.data?.note ?? ''

  return (
    <div className="space-y-5 md:space-y-6">
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
          initialDayNote={dayNoteResult.data?.note ?? ''}
          initialWeightKg={todayWeightResult.data?.weight_kg ?? null}
          lastWeightKg={lastWeightResult.data?.weight_kg ?? null}
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

function formatPeriodDate(dateIso: string, language: string): string {
  // Noon UTC keeps the calendar date the same in every time zone
  return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString(language === 'zh-TW' ? 'zh-TW' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  })
}
