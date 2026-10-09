'use client'

import { useTranslations } from 'next-intl'
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'
import { toDisplayWeight, type WeightUnit } from '@/lib/weight-unit'

// The 體重 tab's chart: the last year of weigh-ins in the unit the user reads in. It is the
// tab's first thing, so it is always open; the weigh-ins themselves are listed below it.

interface WeightEntry {
    id: string
    recordedAt: string
    weightKg: number | null
}

interface WeightTrendCardProps {
    entries: WeightEntry[]
    language: string
    weightUnit: WeightUnit
}

export function WeightTrendCard({ entries, language, weightUnit }: WeightTrendCardProps) {
    const t = useTranslations('history')

    const chartData = entries
        .filter((e) => e.weightKg !== null)
        .map((e) => ({
            label: formatShortDate(e.recordedAt, language),
            weight: toDisplayWeight(e.weightKg as number, weightUnit),
        }))

    const latest = chartData.length > 0 ? chartData[chartData.length - 1].weight : null

    return (
        <section className="space-y-3 rounded-[14px] border border-line bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-bold md:text-[15px]">{t('weightTrend')}</h2>
                {latest !== null && (
                    <p className="font-mono text-2xl font-bold">
                        {latest}<small className="text-[13px] font-medium text-muted"> {weightUnit}</small>
                    </p>
                )}
            </div>
            {chartData.length >= 2 ? (
                // The line takes the text colour, so it follows the theme
                <div className="h-48 text-accent">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                            <CartesianGrid stroke="#2B2B2814" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#2B2B2899' }} tickLine={false} minTickGap={24} />
                            <YAxis tick={{ fontSize: 12, fill: '#2B2B2899' }} width={44} domain={[(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)]} allowDecimals={false} />
                            <Tooltip formatter={(value: number) => [`${value} ${weightUnit}`, t('weightLabel')]} />
                            <Line type="monotone" dataKey="weight" stroke="currentColor" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <p className="text-[15px] text-muted md:text-sm">{t('noWeightData')}</p>
            )}
        </section>
    )
}

function formatShortDate(dateString: string, language: string): string {
    return new Date(dateString).toLocaleDateString(
        language === 'zh-TW' ? 'zh-TW' : 'en-US',
        { month: 'short', day: 'numeric' }
    )
}
