import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { HistoryList } from '@/components/HistoryList'

export interface PeriodOption {
    start: string
    end: string
}

export default async function HistoryPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const t = await getTranslations('history')

    // 並行撈所有資料
    const [profileResult, cycleResult] = await Promise.all([
        supabase
            .from('user_profiles')
            .select('timezone, language')
            .eq('user_id', user.id)
            .maybeSingle(),
        supabase
            .from('training_cycles')
            .select('cycle_length, start_date')
            .eq('user_id', user.id)
            .maybeSingle(),
    ])

    const timezone = profileResult.data?.timezone ?? 'UTC'
    const language = profileResult.data?.language ?? 'en'
    const cycle = cycleResult.data

    const periods = cycle
        ? computeCyclePeriods(cycle.start_date, cycle.cycle_length, 52)
        : computeCalendarWeekPeriods(52, timezone)

    // 並行撈報告跟體重
    const [reportsResult, weightResult] = await Promise.all([
        supabase
            .from('period_reports')
            .select('period_start, status, recommendation, pdf_status, error_message, created_at')
            .eq('user_id', user.id)
            .gte('period_start', getOneYearAgo())
            .order('period_start', { ascending: false }),
        supabase
            .from('body_metrics')
            .select('id, recorded_at, weight_kg')
            .eq('user_id', user.id)
            .gte('recorded_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
            .order('recorded_at', { ascending: true }),
    ])

    return (
        <div className="py-8 space-y-6">
            <h1 className="text-3xl font-bold uppercase tracking-wide">{t('title')}</h1>
            <HistoryList
                userId={user.id}
                periods={periods}
                reports={reportsResult.data ?? []}
                language={language}
                weightEntries={(weightResult.data ?? []).map((e) => ({
                    id: e.id,
                    recordedAt: e.recorded_at,
                    weightKg: e.weight_kg,
                }))}
            />
        </div>
    )
}

function getOneYearAgo(): string {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().split('T')[0]
}

function computeCalendarWeekPeriods(count: number, timezone: string): PeriodOption[] {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
    const parts: Record<string, string> = {}
    for (const part of formatter.formatToParts(now)) {
        parts[part.type] = part.value
    }
    const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
    const day = localDate.getUTCDay()
    const diffToMonday = localDate.getUTCDate() - day + (day === 0 ? -6 : 1)
    const thisMonday = new Date(localDate)
    thisMonday.setUTCDate(diffToMonday)

    const periods: PeriodOption[] = []
    for (let i = 0; i < count; i++) {
        const start = new Date(thisMonday)
        start.setUTCDate(start.getUTCDate() - i * 7)
        const end = new Date(start)
        end.setUTCDate(end.getUTCDate() + 6)
        const startStr = start.toISOString().split('T')[0]
        if (startStr < getOneYearAgo()) break
        periods.push({ start: startStr, end: end.toISOString().split('T')[0] })
    }
    return periods
}

function computeCyclePeriods(startDate: string, cycleLength: number, count: number): PeriodOption[] {
    const start = new Date(`${startDate}T00:00:00Z`)
    const today = new Date()
    const daysSinceStart = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
    const currentIndex = Math.max(0, Math.floor(daysSinceStart / cycleLength))

    const periods: PeriodOption[] = []
    for (let i = 0; i < count && currentIndex - i >= 0; i++) {
        const index = currentIndex - i
        const periodStart = addDays(startDate, index * cycleLength)
        if (periodStart < getOneYearAgo()) break
        const periodEnd = addDays(periodStart, cycleLength - 1)
        periods.push({ start: periodStart, end: periodEnd })
    }
    return periods
}

function addDays(dateIso: string, days: number): string {
    const date = new Date(`${dateIso}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().split('T')[0]
}