import { createClient } from '@/lib/supabase/server'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { addDays, localDate, type CycleSettings } from '@/lib/periods'
import { isDate, trainingReadAhead, trainingView } from '@/lib/history'
import { historyDaysOf, loadReports } from '@/lib/history-data'
import { readHistoryData } from '@/lib/history-page'
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
// One round: the tab's reads go out with the profile. Training's range and the weight chart's
// year depend on the user's zone, so they are read as wide as any zone can make them and cut to
// the user's once the profile is in; training's rows come in one request (lib/history-page.ts).
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; day?: string; report?: string }> }) {
    const user = await getSessionUser()
    if (!user) redirect('/login')
    const supabase = await createClient()
    const params = await searchParams
    const tab: HistoryTab = params.tab === 'weight' || params.tab === 'reports' ? params.tab : 'training'
    const utcToday = new Date().toISOString().slice(0, 10)

    const training = tab === 'training' ? readHistoryData(supabase, user.id, trainingReadAhead(utcToday, params.day)) : null
    // The chart covers the last year: a day more, for any zone. Promise.resolve sends the query
    // now; it would go out only when awaited.
    const weights = tab === 'weight'
        ? Promise.resolve(supabase
            .from('body_metrics')
            .select('id, recorded_at, weight_kg')
            .eq('user_id', user.id)
            .gte('recorded_at', addDays(utcToday, -366))
            .order('recorded_at', { ascending: true }))
        : null
    const reportsTab = tab === 'reports'
        ? Promise.all([
            supabase.from('training_cycles').select('cycle_length, start_date').eq('user_id', user.id).maybeSingle(),
            loadReports(supabase, user.id),
        ])
        : null
    const [{ profile }, t] = await Promise.all([getFrameProfile(), getTranslations('history')])

    const timeZone = timeZoneOf(profile?.timezone)
    const language = await getEffectiveLanguage(profile)
    const weightUnit: WeightUnit = profile?.weight_unit === 'lb' ? 'lb' : 'kg'
    const distanceUnit: DistanceUnit = profile?.distance_unit === 'mi' ? 'mi' : 'km'
    const today = localDate(timeZone, new Date())
    const cycleOf = (row: { cycle_length: number; start_date: string } | null): CycleSettings | null =>
        row ? { cycleLength: row.cycle_length, startDate: row.start_date } : null

    let content: React.ReactNode
    if (training) {
        // A link to one day opens on that day's month
        const { month, range } = trainingView(today, params.day)
        const { cycle: cycleRow, history, reports, firstTrainedAt } = await training

        content = (
            <HistoryTraining
                today={today}
                initialMonth={month}
                cycle={cycleOf(cycleRow)}
                plan={cycleRow && {
                    routineByDay: Object.fromEntries(cycleRow.cycle_days.map((d) => [d.day_index, d.routine_id])),
                    changes: Object.fromEntries(cycleRow.cycle_date_changes.map((c) => [c.change_date, c.routine_id])),
                }}
                initialRange={range}
                initialDays={historyDaysOf(history, { range, timeZone, language })}
                initialReports={reports.filter((r) => r.periodStart >= range.start && r.periodStart <= range.end)}
                firstDate={firstTrainedAt && localDate(timeZone, new Date(firstTrainedAt))}
                language={language}
                units={{ weight: weightUnit, distance: distanceUnit }}
            />
        )
    } else if (weights) {
        const from = Date.parse(`${addDays(today, -365)}T00:00:00Z`)
        const { data } = await weights

        content = (
            <HistoryWeight
                language={language}
                weightUnit={weightUnit}
                timeZone={timeZone}
                entries={(data ?? []).filter((e) => Date.parse(e.recorded_at) >= from).map((e) => ({ id: e.id, recordedAt: e.recorded_at, weightKg: e.weight_kg }))}
            />
        )
    } else if (reportsTab) {
        const [cycleResult, reports] = await reportsTab

        content = (
            <HistoryReports
                initialReports={reports}
                // Today's "see the full report" opens that period's report here
                openPeriod={isDate(params.report) ? params.report : null}
                cycle={cycleOf(cycleResult.data)}
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
