import { createClient } from '@/lib/supabase/server'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { addDays, localDate, type CycleSettings } from '@/lib/periods'
import { isDate, monthOf, periodsBack, periodsInMonth, PERIODS_PER_PAGE, rangeOf } from '@/lib/history'
import { loadFirstTrainedDate, loadHistoryDays, loadReports, loadReportStatuses } from '@/lib/history-data'
import { HistoryReports, HistoryTabs, HistoryTraining, HistoryWeight, type HistoryTab } from '@/components/HistoryList'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { timeZoneOf } from '@/lib/time-zone'
import { ServerTimingMark } from '@/components/ServerTimingMark'
import { ReadYourWrites } from '@/components/ReadYourWrites'

// 紀錄: tabs for training, body weight and reports (?tab=). Each tab reads only what it
// shows, by date range: records are kept forever and the page must not slow down as
// they grow. Training starts with this month and the last four periods (one query
// covers both); the rest loads from /api/history/workouts as the user goes back.
// Two rounds: the profile and the cycle (with its days and rest days), then the tab's records.
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string; report?: string }> }) {
    const user = await getSessionUser()
    if (!user) redirect('/login')
    const supabase = await createClient()

    const [{ profile }, cycleResult, t, params] = await Promise.all([
        getFrameProfile(),
        supabase
            .from('training_cycles')
            .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id ), cycle_rest_days ( rest_date )')
            .eq('user_id', user.id)
            .maybeSingle(),
        getTranslations('history'),
        searchParams,
    ])
    const tab: HistoryTab = params.tab === 'weight' || params.tab === 'reports' ? params.tab : 'training'

    const timeZone = timeZoneOf(profile?.timezone)
    const language = await getEffectiveLanguage(profile)
    const weightUnit: WeightUnit = profile?.weight_unit === 'lb' ? 'lb' : 'kg'
    const distanceUnit: DistanceUnit = profile?.distance_unit === 'mi' ? 'mi' : 'km'
    const cycleRow = cycleResult.data
    const cycle: CycleSettings | null = cycleRow ? { cycleLength: cycleRow.cycle_length, startDate: cycleRow.start_date } : null
    const today = localDate(timeZone, new Date())

    let content: React.ReactNode
    if (tab === 'training') {
        // A link to one day opens on that day's month
        const day = isDate(params.day) && params.day <= today ? params.day : null
        const month = monthOf(day ?? today)
        const range = rangeOf([...periodsBack(today, PERIODS_PER_PAGE, cycle, today), ...periodsInMonth(month, cycle, today)])

        const [days, reports, firstDate] = await Promise.all([
            loadHistoryDays(supabase, { userId: user.id, range, timeZone, language }),
            loadReportStatuses(supabase, user.id, range),
            loadFirstTrainedDate(supabase, user.id, timeZone),
        ])

        content = (
            <HistoryTraining
                today={today}
                initialMonth={month}
                cycle={cycle}
                plan={cycleRow && {
                    routineByDay: Object.fromEntries(cycleRow.cycle_days.map((d) => [d.day_index, d.routine_id])),
                    restDates: cycleRow.cycle_rest_days.map((r) => r.rest_date),
                }}
                initialRange={range}
                initialDays={days}
                initialReports={reports}
                firstDate={firstDate}
                language={language}
                units={{ weight: weightUnit, distance: distanceUnit }}
            />
        )
    } else if (tab === 'weight') {
        // The chart covers the last year
        const { data } = await supabase
            .from('body_metrics')
            .select('id, recorded_at, weight_kg')
            .eq('user_id', user.id)
            .gte('recorded_at', addDays(today, -365))
            .order('recorded_at', { ascending: true })

        content = (
            <HistoryWeight
                language={language}
                weightUnit={weightUnit}
                timeZone={timeZone}
                entries={(data ?? []).map((e) => ({ id: e.id, recordedAt: e.recorded_at, weightKg: e.weight_kg }))}
            />
        )
    } else {
        content = (
            <HistoryReports
                initialReports={await loadReports(supabase, user.id)}
                // Today's "see the full report" opens that period's report here
                openPeriod={isDate(params.report) ? params.report : null}
                cycle={cycle}
                language={language}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
            />
        )
    }

    return (
        <div className="space-y-5 md:space-y-4">
            <ServerTimingMark />
            <ReadYourWrites />
            <h1 className="text-2xl font-bold max-md:sr-only">{t('title')}</h1>
            <HistoryTabs current={tab} />
            {content}
        </div>
    )
}
