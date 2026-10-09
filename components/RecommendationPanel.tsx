'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import type { AiRecommendation } from './types'
import type { WeightUnit } from '@/lib/weight-unit'
import { isReportV3, ReportView } from './report/ReportView'
import { FailedReport } from './report/FailedReport'

interface RecommendationPanelProps {
    userId: string
    language: string
    weightUnit: WeightUnit
}

type Status = 'idle' | 'pending' | 'completed' | 'insufficient_data' | 'failed'

const SEVERITY_STYLES: Record<string, string> = {
    mild: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    moderate: 'bg-orange-50 text-orange-800 border-orange-200',
    severe: 'bg-red-50 text-red-800 border-red-200',
}

const CHART_COLORS = ['#4A9EFF', '#FF6B6B', '#51CF66', '#FFD43B', '#CC5DE8', '#FF922B']

interface StrengthHistoryPoint {
    label: string
    [muscleGroup: string]: string | number
}

// The latest report on the dashboard, in one card. On a phone nothing inside the card is a
// box of its own (ReportView flattens the same way): sections are set apart by lines.
export function RecommendationPanel({ userId, language, weightUnit }: RecommendationPanelProps) {
    const supabase = createClient()
    const t = useTranslations('report')
    const tV3 = useTranslations('reportV3')
    const [status, setStatus] = useState<Status>('idle')
    const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null)
    const [periodStart, setPeriodStart] = useState<string | null>(null)
    const [strengthHistory, setStrengthHistory] = useState<StrengthHistoryPoint[]>([])
    const [muscleGroupsInHistory, setMuscleGroupsInHistory] = useState<string[]>([])

    // State is set when the query answers, never while an effect runs
    const checkStatus = useCallback(() => supabase
        .from('period_reports')
        .select('status, recommendation, period_start')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
            if (!data) return
            setStatus(data.status as Status)
            setPeriodStart(data.period_start)
            if (data.status === 'completed') {
                setRecommendation(data.recommendation as unknown as AiRecommendation)
            }
        }), [supabase, userId])

    const loadStrengthHistory = useCallback(() => supabase
        .from('period_reports')
        .select('period_start, recommendation')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('period_start', { ascending: false })
        .limit(6)
        .then(({ data }) => {
            const chronological = (data ?? []).slice().reverse()
            const groups = new Set<string>()

            const points: StrengthHistoryPoint[] = chronological.map((row) => {
                const rec = row.recommendation as unknown as AiRecommendation
                const point: StrengthHistoryPoint = { label: formatShortDate(row.period_start) }
                for (const [muscle, data] of Object.entries(rec.strengthIndex ?? {})) {
                    point[muscle] = data.currentIndex
                    groups.add(muscle)
                }
                return point
            })

            setStrengthHistory(points)
            setMuscleGroupsInHistory(Array.from(groups).sort())
        }), [supabase, userId])

    useEffect(() => {
        void checkStatus()
    }, [checkStatus])

    useEffect(() => {
        if (status === 'completed') {
            void loadStrengthHistory()
        }
    }, [status, loadStrengthHistory])

    // The worker finishes in seconds, but nothing pushes its result back to
    // the browser — keep checking until the report leaves 'pending'.
    useEffect(() => {
        if (status !== 'pending') return
        const timer = setInterval(checkStatus, 5000)
        return () => clearInterval(timer)
    }, [status, checkStatus])

    return (
        <div className="space-y-4 rounded-[14px] border border-line bg-card p-4 md:p-6">
            {status === 'idle' && (
                <p className="text-[15px] text-muted md:text-sm">{t('idle')}</p>
            )}

            {status === 'pending' && (
                <div className="flex items-center gap-3 text-muted">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                    <span>{t('pending')}</span>
                </div>
            )}

            {status === 'completed' && recommendation && isReportV3(recommendation) && (
                <ReportView report={recommendation} language={language} weightUnit={weightUnit} />
            )}

            {status === 'completed' && recommendation && !isReportV3(recommendation) && (
                <RecommendationDisplay
                    recommendation={recommendation}
                    strengthHistory={strengthHistory}
                    muscleGroups={muscleGroupsInHistory}
                />
            )}

            {/* error_message is the English cause for logs; users get the localized line */}
            {status === 'insufficient_data' && (
                <p className="text-[15px] text-muted md:text-base">{tV3('insufficient')}</p>
            )}

            {/* A retried report is 'pending' again, which restarts the polling above */}
            {status === 'failed' && periodStart && <FailedReport periodStart={periodStart} onRetried={checkStatus} />}
        </div>
    )
}

function RecommendationDisplay({
    recommendation,
    strengthHistory,
    muscleGroups,
}: {
    recommendation: AiRecommendation
    strengthHistory: StrengthHistoryPoint[]
    muscleGroups: string[]
}) {
    const t = useTranslations('report')
    const [showMore, setShowMore] = useState(false)

    const pieData = Object.entries(recommendation.volumeSplit ?? {}).map(([name, value]) => ({
        name,
        value,
    }))

    const severeImbalances = recommendation.muscleImbalances.filter((i) => i.severity === 'severe')
    const { bodyMetrics } = recommendation

    return (
        <div className="space-y-5">
            {/* ---------- Top row: Training Split + Body Metrics ---------- */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-ink/10 p-4 max-md:rounded-none max-md:border-0 max-md:border-t max-md:px-0 max-md:pb-0 max-md:pt-4 max-md:border-t-0 max-md:pt-0">
                    <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide max-md:text-[13px] mb-2">
                        {t('trainingSplit')}
                    </h3>
                    {pieData.length > 0 ? (
                        <div className="h-40">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={55}>
                                        {pieData.map((entry, i) => (
                                            <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value: number) => `${value}%`} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-sm text-ink/40 max-md:text-[15px]">{t('noData')}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/60 max-md:text-[13px]">
                        {pieData.map((entry, i) => (
                            <span key={entry.name} className="flex items-center gap-1 capitalize">
                                <span
                                    className="inline-block h-2 w-2 rounded-full"
                                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                                />
                                {entry.name} {entry.value}%
                            </span>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-ink/10 p-4 max-md:rounded-none max-md:border-0 max-md:border-t max-md:px-0 max-md:pb-0 max-md:pt-4">
                    <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide max-md:text-[13px] mb-2">
                        {t('bodyMetrics')}
                    </h3>
                    <div className="grid grid-cols-2 gap-y-2 text-sm max-md:text-[15px]">
                        <MetricCell label={t('weight')} value={bodyMetrics?.weightKg ? `${bodyMetrics.weightKg} kg` : '—'} />
                        <MetricCell label={t('height')} value={bodyMetrics?.heightCm ? `${bodyMetrics.heightCm} cm` : '—'} />
                        <MetricCell label={t('bmi')} value={bodyMetrics?.bmi ? `${bodyMetrics.bmi}` : '—'} />
                        <MetricCell
                            label={t('ageSex')}
                            value={
                                bodyMetrics?.ageYears || bodyMetrics?.sex
                                    ? `${bodyMetrics?.ageYears ?? '—'} / ${bodyMetrics?.sex ?? '—'}`
                                    : '—'
                            }
                        />
                    </div>
                </div>
            </div>

            {/* ---------- Strength trend ---------- */}
            {strengthHistory.length >= 2 && muscleGroups.length > 0 && (
                <div className="rounded-xl border border-ink/10 p-4 max-md:rounded-none max-md:border-0 max-md:border-t max-md:px-0 max-md:pb-0 max-md:pt-4">
                    <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide max-md:text-[13px] mb-1">
                        {t('strengthTrend')}
                    </h3>
                    <p className="text-xs text-ink/40 mb-2 max-md:text-[13px]">{t('strengthTrendNote')}</p>
                    <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={strengthHistory} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                <CartesianGrid stroke="#2B2B2814" vertical={false} />
                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#2B2B2899' }} />
                                <YAxis tick={{ fontSize: 11, fill: '#2B2B2899' }} width={36} />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                {muscleGroups.map((muscle, i) => (
                                    <Line
                                        key={muscle}
                                        type="monotone"
                                        dataKey={muscle}
                                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                        strokeWidth={2}
                                        dot={{ r: 3 }}
                                        connectNulls
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* ---------- Warnings ---------- */}
            {severeImbalances.length > 0 && (
                <div className="space-y-2">
                    {severeImbalances.map((item, i) => (
                        <div
                            key={i}
                            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 max-md:text-[15px] md:border md:border-red-200"
                        >
                            <span className="font-semibold capitalize">⚠ {item.muscleGroup}</span>
                            {' — '}
                            {item.observation}
                        </div>
                    ))}
                </div>
            )}

            {/* ---------- Headline + Read more ---------- */}
            <div className="space-y-2">
                <p className="text-base font-medium">{recommendation.headline}</p>

                {!showMore ? (
                    <button
                        type="button"
                        onClick={() => setShowMore(true)}
                        className="min-h-11 text-sm text-plate dark:text-[#C8955A] underline hover:opacity-70 transition-opacity max-md:text-[15px] md:min-h-0"
                    >
                        {t('readMore')}
                    </button>
                ) : (
                    <div className="space-y-5 pt-2">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 max-md:text-[13px]">
                                {t('summary')}
                            </h3>
                            <p className="text-sm text-gray-700 max-md:text-[15px]">{recommendation.summary}</p>
                        </div>

                        <div>
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 max-md:text-[13px]">
                                {t('progressiveOverload')}
                            </h3>
                            <p className="text-sm text-gray-600 max-md:text-[15px]">{recommendation.progressiveOverload.notes}</p>
                        </div>

                        {recommendation.muscleImbalances.length > 0 && (
                            <div>
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 max-md:text-[13px]">
                                    {t('thingsToWatch')}
                                </h3>
                                <div className="space-y-2">
                                    {recommendation.muscleImbalances.map((imbalance, i) => (
                                        <div
                                            key={i}
                                            className={`rounded px-3 py-2 text-sm max-md:border-0 max-md:text-[15px] md:border ${SEVERITY_STYLES[imbalance.severity] ?? ''}`}
                                        >
                                            <span className="font-semibold capitalize">{imbalance.muscleGroup}</span>
                                            {' — '}
                                            {imbalance.observation}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {recommendation.deloadRecommended && (
                            <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-800 max-md:text-[15px] md:border md:border-red-200">
                                <span className="font-semibold">{t('deloadRecommended')} </span>
                                {recommendation.deloadReason}
                            </div>
                        )}

                        <div>
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 max-md:text-[13px]">
                                {t('whatToDoNext')}
                            </h3>
                            <ul className="list-disc list-inside space-y-1 text-sm max-md:text-[15px]">
                                {recommendation.actionItems.map((item, i) => (
                                    <li key={i}>{item}</li>
                                ))}
                            </ul>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowMore(false)}
                            className="min-h-11 text-sm text-ink/50 dark:text-white/50 hover:text-ink dark:hover:text-white underline transition-colors max-md:text-[15px] md:min-h-0"
                        >
                            {t('showLess')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

function MetricCell({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="block text-xs text-ink/40 max-md:text-[13px]">{label}</span>
            <span className="font-mono">{value}</span>
        </div>
    )
}

function formatShortDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}