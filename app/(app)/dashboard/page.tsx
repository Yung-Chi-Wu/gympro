import { createClient } from '@/lib/supabase/server'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { RecommendationPanel } from '@/components/RecommendationPanel'
import { TodayWorkoutCard } from '@/components/TodayWorkoutCard'
import { PeriodNoteCard } from '@/components/PeriodNoteCard'
import { TodayGoal } from '@/components/TodayGoal'
import { ReminderNotice } from '@/components/ReminderNotice'
import { OnboardingGuard } from '@/components/OnboardingGuard'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { withRecent } from '@/lib/recent-exercises'
import { loadTodayData, readTodayPage, todayFromPage } from '@/lib/today-page'
import { reportError } from '@/lib/report-error'
import type { LatestReport } from '@/lib/report/latest'
import type { AimFinding } from '@/lib/report/progression'
import { ServerTimingMark } from '@/components/ServerTimingMark'
import { ReadYourWrites } from '@/components/ReadYourWrites'

// 今天. Who is signed in is checked here (no network). Then the page is read in one request
// (today_page, lib/today-page.ts) beside the profile, which the frame reads anyway. When that
// request fails, or works the day out differently from the profile, the page is read the old way,
// in two rounds of requests.
export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const supabase = await createClient()
  // The instant the day is worked out from, on both sides
  const now = new Date()

  const [{ profile }, page, t, tReport, tPeriod] = await Promise.all([
    getFrameProfile(),
    readTodayPage(supabase, now),
    getTranslations('today'),
    getTranslations('report'),
    getTranslations('periodLog'),
  ])
  const language = await getEffectiveLanguage(profile)
  const input = { userId: user.id, profile, language, now }
  if (page.error) reportError('today-page', page.error, { userId: user.id })
  const day = (page.data && await todayFromPage(page.data, input)) || await loadTodayData(supabase, input)
  const { period, todayIso, todayRange, dayIndex, routineIdForToday, routineName, today, periodNote, lastPeriod, recentFrom, latestReport } = day

  const onboardingCompleted = profile?.onboarding_completed ?? false
  const weightUnit = (profile?.weight_unit as WeightUnit) ?? 'kg'
  const distanceUnit: DistanceUnit = profile?.distance_unit === 'mi' ? 'mi' : 'km'

  const hasCycle = day.cycleLength !== null
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

      {/* As on the other tabs: the top bar says 今天 on a phone. The greeting that was here gave
          its place to the goal (owner, 2026-10-28) */}
      <h1 className="text-2xl font-bold max-md:sr-only">{t('title')}</h1>
      {/* Once a device can get the daily reminder: where to turn it on */}
      <ReminderNotice ready={onboardingCompleted} />
      <TodayGoal goal={profile?.training_goal ?? null} latest={latestReport} language={language} weightUnit={weightUnit} />

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
          cycleLength={day.cycleLength ?? 0}
          initialExercises={today.exercises}
          allExercises={withRecent(day.library, day.recentIds)}
          language={language}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          routineName={routineName}
          initialDayNote={day.dayNote}
          initialWeightKg={day.todayWeightKg}
          lastWeightKg={day.lastWeightKg}
          aims={{ today: todayIso, lastPeriod, findings: aimFindings(latestReport, lastPeriod), unit: 'week', recentFrom }}
        />

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">{tReport('sectionTitle')}</h2>
            <p className="text-[13px] text-muted">
              {tPeriod('reportSchedule', { end: formatPeriodDate(period.periodEnd, language) })}
            </p>
          </div>
          {periodNote && <PeriodNoteCard initialNote={periodNote} />}
          <RecommendationPanel userId={user.id} initial={latestReport} language={language} weightUnit={weightUnit} distanceUnit={distanceUnit} />
        </section>
      </div>
    </div>
  )
}

/** What today's aims take from the report: a lift held for pain, a lighter week, a goal lift taken down */
const AIM_RULES = new Set(['pain_hold', 'next_session', 'goal_path'])

/** The newest report's findings that speak to today's aims, when it is of the period that just ended */
function aimFindings(report: LatestReport | null, lastPeriod: { start: string } | null): AimFinding[] {
  const findings = (report?.recommendation as { version?: number; findings?: unknown } | null)?.findings
  if (report?.status !== 'completed' || !lastPeriod || report.periodStart !== lastPeriod.start || !Array.isArray(findings)) return []
  return (findings as AimFinding[]).filter((f) => AIM_RULES.has(f.rule) && typeof f.subject === 'string' && typeof f.data === 'object' && f.data !== null)
    .map(({ rule, subject, data }) => ({ rule, subject, data }))
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
