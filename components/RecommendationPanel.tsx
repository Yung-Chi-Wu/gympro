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
import { getReportPdfUrl } from '@/app/(app)/dashboard/pdf-actions'
import type { AiRecommendation } from './types'

interface RecommendationPanelProps {
    userId: string
    language: string
}

type Status = 'idle' | 'pending' | 'completed' | 'insufficient_data' | 'failed'

const SEVERITY_STYLES: Record<string, string> = {
    mild: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    moderate: 'bg-orange-50 text-orange-800 border-orange-200',
    severe: 'bg-red-50 text-red-800 border-red-200',
}

const CHART_COLORS = ['#26241F', '#8A5A44', '#4A6B5A', '#5A6B8A', '#8A7A44', '#6B4A6B']

interface StrengthHistoryPoint {
    label: string
    [muscleGroup: string]: string | number
}

export function RecommendationPanel({ userId, language }: RecommendationPanelProps) {
    const supabase = createClient()
    const t = useTranslations('report')
    const [status, setStatus] = useState<Status>('idle')
    const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [latestPeriodStart, setLatestPeriodStart] = useState<string | null>(null)
    const [strengthHistory, setStrengthHistory] = useState<StrengthHistoryPoint[]>([])
    const [muscleGroupsInHistory, setMuscleGroupsInHistory] = useState<string[]>([])

    const checkStatus = useCallback(async () => {
        const { data } = await supabase
            .from('period_reports')
            .select('status, recommendation, error_message, period_start')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (!data) return

        setStatus(data.status as Status)
        setLatestPeriodStart(data.period_start)
        if (data.status === 'completed') {
            setRecommendation(data.recommendation as unknown as AiRecommendation)
        }
        if (data.status === 'failed' || data.status === 'insufficient_data') {
            setErrorMessage(data.error_message)
        }
    }, [supabase, userId])

    const loadStrengthHistory = useCallback(async () => {
        const { data } = await supabase
            .from('period_reports')
            .select('period_start, recommendation')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .order('period_start', { ascending: false })
            .limit(6)

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
    }, [supabase, userId])

    useEffect(() => {
        checkStatus()
    }, [checkStatus])

    useEffect(() => {
        if (status === 'completed') {
            loadStrengthHistory()
        }
    }, [status, loadStrengthHistory])

    useEffect(() => {
        window.addEventListener('period-checkin-success', checkStatus)
        return () => window.removeEventListener('period-checkin-success', checkStatus)
    }, [checkStatus])

    return (
        <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-4 shadow-sm">
            {status === 'idle' && (
                <p className="text-sm text-ink/60">{t('idle')}</p>
            )}

            {status === 'pending' && (
                <div className="flex items-center gap-3 text-gray-600">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                    <span>{t('pending')}</span>
                </div>
            )}

            {status === 'completed' && recommendation && latestPeriodStart && (
                <RecommendationDisplay
                    recommendation={recommendation}
                    periodStart={latestPeriodStart}
                    strengthHistory={strengthHistory}
                    muscleGroups={muscleGroupsInHistory}
                    language={language}
                />
            )}

            {status === 'insufficient_data' && (
                <p className="text-gray-600">{errorMessage}</p>
            )}

            {status === 'failed' && (
                <p className="text-red-600">{errorMessage ?? 'Something went wrong.'}</p>
            )}
        </div>
    )
}

function RecommendationDisplay({
    recommendation,
    periodStart,
    strengthHistory,
    muscleGroups,
    language,
}: {
    recommendation: AiRecommendation
    periodStart: string
    strengthHistory: StrengthHistoryPoint[]
    muscleGroups: string[]
    language: string
}) {
    const t = useTranslations('report')
    const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'error'>('idle')
    const [showMore, setShowMore] = useState(false)

    async function handleDownloadPdf() {
        setPdfState('loading')
        const result = await getReportPdfUrl(periodStart)
        if (result.success && result.url) {
            window.open(result.url, '_blank', 'noopener,noreferrer')
            setPdfState('idle')
        } else {
            setPdfState('error')
        }
    }

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
                <div className="rounded-xl border border-ink/10 p-4">
                    <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide mb-2">
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
                        <p className="text-sm text-ink/40">{t('noData')}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/60">
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

                <div className="rounded-xl border border-ink/10 p-4">
                    <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide mb-2">
                        {t('bodyMetrics')}
                    </h3>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
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
                <div className="rounded-xl border border-ink/10 p-4">
                    <h3 className="text-xs font-semibold text-ink/40 uppercase tracking-wide mb-1">
                        {t('strengthTrend')}
                    </h3>
                    <p className="text-xs text-ink/40 mb-2">{t('strengthTrendNote')}</p>
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
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
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
                        className="inline-flex items-center gap-1.5 rounded-lg bg-plate px-4 py-2 text-sm font-medium text-chalk hover:bg-plate-light transition-colors"
                    >
                        {t('readMore')} →
                    </button>
                ) : (
                    <div className="space-y-5 pt-2">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                {t('summary')}
                            </h3>
                            <p className="text-sm text-gray-700">{recommendation.summary}</p>
                        </div>

                        <div>
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                {t('progressiveOverload')}
                            </h3>
                            <p className="text-sm text-gray-600">{recommendation.progressiveOverload.notes}</p>
                        </div>

                        {recommendation.muscleImbalances.length > 0 && (
                            <div>
                                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                    {t('thingsToWatch')}
                                </h3>
                                <div className="space-y-2">
                                    {recommendation.muscleImbalances.map((imbalance, i) => (
                                        <div
                                            key={i}
                                            className={`rounded border px-3 py-2 text-sm ${SEVERITY_STYLES[imbalance.severity] ?? ''}`}
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
                            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                <span className="font-semibold">{t('deloadRecommended')} </span>
                                {recommendation.deloadReason}
                            </div>
                        )}

                        <div>
                            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                {t('whatToDoNext')}
                            </h3>
                            <ul className="list-disc list-inside space-y-1 text-sm">
                                {recommendation.actionItems.map((item, i) => (
                                    <li key={i}>{item}</li>
                                ))}
                            </ul>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowMore(false)}
                            className="text-sm text-ink/50 dark:text-white/50 hover:text-ink dark:hover:text-white underline transition-colors"
                        >
                            {t('showLess')}
                        </button>
                    </div>
                )}
            </div>

            {/* ---------- Download PDF ---------- */}
            <div className="pt-2">
                <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={pdfState === 'loading'}
                    className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                >
                    {pdfState === 'loading' ? t('preparing') : t('downloadPdf')}
                </button>
                {pdfState === 'error' && (
                    <p className="mt-2 text-sm text-ink/60">{t('pdfNotReady')}</p>
                )}
            </div>
        </div>
    )
}

function MetricCell({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="block text-xs text-ink/40">{label}</span>
            <span className="font-mono">{value}</span>
        </div>
    )
}

function formatShortDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}