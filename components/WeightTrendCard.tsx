'use client'

import { useState } from 'react'
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

interface WeightEntry {
    id: string
    recordedAt: string
    weightKg: number | null
}

interface WeightTrendCardProps {
    entries: WeightEntry[]
    language: string
}

export function WeightTrendCard({ entries, language }: WeightTrendCardProps) {
    const t = useTranslations('history')
    const [isOpen, setIsOpen] = useState(false)

    const chartData = entries
        .filter((e) => e.weightKg !== null)
        .map((e) => ({
            label: formatShortDate(e.recordedAt, language),
            weightKg: e.weightKg as number,
        }))

    const latestWeight = chartData.length > 0 ? chartData[chartData.length - 1].weightKg : null

    return (
        <div className="rounded-2xl border border-ink/10 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                className="flex w-full items-center justify-between p-6 text-left"
            >
                <div>
                    <h2 className="text-lg font-semibold uppercase tracking-wide">
                        {t('weightTrend')}
                    </h2>
                    {latestWeight && (
                        <p className="text-sm text-ink/40 mt-0.5">
                            {language === 'zh-TW' ? '最近' : 'Latest'}: {latestWeight} kg
                        </p>
                    )}
                </div>
                <span className="text-ink/40">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <div className="border-t border-ink/10 p-6">
                    {chartData.length >= 2 ? (
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                    <CartesianGrid stroke="#2B2B2814" vertical={false} />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fontSize: 11, fill: '#2B2B2899' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 11, fill: '#2B2B2899' }}
                                        width={36}
                                        domain={['dataMin - 2', 'dataMax + 2']}
                                    />
                                    <Tooltip
                                        formatter={(value: number) => [
                                            `${value} kg`,
                                            language === 'zh-TW' ? '體重' : 'Weight',
                                        ]}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="weightKg"
                                        stroke="#26241F"
                                        strokeWidth={2}
                                        dot={{ r: 4, fill: '#26241F' }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-sm text-ink/40">{t('noWeightData')}</p>
                    )}

                    {chartData.length > 0 && (
                        <div className="mt-4 space-y-1">
                            {[...chartData].reverse().slice(0, 8).map((entry, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                    <span className="text-ink/60">{entry.label}</span>
                                    <span className="font-mono">{entry.weightKg} kg</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function formatShortDate(dateString: string, language: string): string {
    return new Date(dateString).toLocaleDateString(
        language === 'zh-TW' ? 'zh-TW' : 'en-US',
        { month: 'short', day: 'numeric' }
    )
}