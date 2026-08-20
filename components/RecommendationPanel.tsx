'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    PieChart,
    Pie,
    Cell,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { getReportPdfUrl } from '@/app/(app)/dashboard/pdf-actions'
import type { AiRecommendation } from './types'

interface RecommendationPanelProps {
    userId: string
}

type Status = 'idle' | 'pending' | 'completed' | 'insufficient_data' | 'failed'

const SEVERITY_STYLES: Record<string, string> = {
    mild: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    moderate: 'bg-orange-50 text-orange-800 border-orange-200',
    severe: 'bg-red-50 text-red-800 border-red-200',
}

const PIE_COLORS = ['#26241F', '#8A5A44', '#4A6B5A', '#5A6B8A', '#8A7A44', '#6B4A6B']

export function RecommendationPanel({ userId }: RecommendationPanelProps) {
    const supabase = createClient()
    const [status, setStatus] = useState<Status>('idle')
    const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [latestPeriodStart, setLatestPeriodStart] = useState<string | null>(null)

    const checkStatus = useCallback(async () => {
        const { data } = await supabase
            .from('period_reports')
            .select('status, recommendation, error_message, period_start')
            .eq('user_id', userId)
            .order('period_start', { ascending: false })
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

    useEffect(() => {
        checkStatus()
    }, [checkStatus])

    useEffect(() => {
        window.addEventListener('period-checkin-success', checkStatus)
        return () => window.removeEventListener('period-checkin-success', checkStatus)
    }, [checkStatus])

    return (
        <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-4 shadow-sm">
            {status === 'idle' && (
                <p className="text-sm text-ink/60">
                    Your latest report will appear here once you check in.
                </p>
            )}

            {status === 'pending' && (
                <div className="flex items-center gap-3 text-gray-600">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                    <span>Analyzing your training data...</span>
                </div>
            )}

            {status === 'completed' && recommendation && latestPeriodStart && (
                <RecommendationDisplay recommendation={recommendation} periodStart={latestPeriodStart} />
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
}: {
    recommendation: AiRecommendation
    periodStart: string
}) {
    const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'error'>('idle')

    async function handleDownloadPdf() {
        setPdfState('loading')
        const result = await getReportPdfUrl(periodStart)
        if (result.success && result.url) {
            window.location.href = result.url
            setPdfState('idle')
        } else {
            setPdfState('error')
        }
    }

    const pieData = Object.entries(recommendation.volumeSplit ?? {}).map(([name, value]) => ({
        name,
        value,
    }))

    const strengthEntries = Object.entries(recommendation.strengthIndex ?? {})

    return (
        <div className="space-y-6">
            <p className="text-lg font-medium">{recommendation.summary}</p>

            {strengthEntries.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Strength Index
                    </h3>
                    <p className="text-xs text-ink/40 mb-2">
                        100 = your baseline when you first logged each exercise. Higher means stronger.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        {strengthEntries.map(([muscle, data]) => {
                            const change =
                                data.previousIndex !== null
                                    ? data.currentIndex - data.previousIndex
                                    : null
                            return (
                                <div key={muscle} className="rounded-xl bg-plate/10 px-4 py-3 text-sm">
                                    <span className="font-medium capitalize">{muscle}</span>
                                    <span className="block font-mono text-ink/60 mt-1">
                                        {data.currentIndex}
                                        {change !== null && (
                                            <span
                                                className={
                                                    change >= 0 ? 'text-green-700 ml-1' : 'text-red-600 ml-1'
                                                }
                                            >
                                                {change >= 0 ? '+' : ''}
                                                {change}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {pieData.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Training Split
                    </h3>
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    dataKey="value"
                                    nameKey="name"
                                    outerRadius={80}
                                    label={(entry) => `${entry.name} ${entry.value}%`}
                                >
                                    {pieData.map((entry, i) => (
                                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value: number) => `${value}%`} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    This Period's Volume
                </h3>
                <p className="text-sm text-ink/60 mb-2 font-mono">
                    {recommendation.weeklyVolume.totalSets} total sets · {recommendation.weeklyVolume.totalTonnageKg} kg total tonnage
                </p>
                <div className="grid grid-cols-2 gap-3">
                    {Object.entries(recommendation.weeklyVolume.byMuscleGroup).map(
                        ([muscle, data]) => (
                            <div key={muscle} className="rounded-xl bg-plate/10 px-4 py-3 text-sm">
                                <span className="font-medium capitalize">{muscle}</span>
                                <span className="block font-mono text-ink/60 mt-1">
                                    {data.sets} sets · {data.tonnageKg} kg
                                </span>
                            </div>
                        )
                    )}
                </div>
            </div>

            <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Progressive Overload
                </h3>
                <p className="text-sm text-gray-600">{recommendation.progressiveOverload.notes}</p>
            </div>

            {recommendation.muscleImbalances.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Things to Watch
                    </h3>
                    <div className="space-y-2">
                        {recommendation.muscleImbalances.map((imbalance, i) => (
                            <div
                                key={i}
                                className={`rounded border px-3 py-2 text-sm ${SEVERITY_STYLES[imbalance.severity] ?? ''
                                    }`}
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
                    <span className="font-semibold">Deload recommended: </span>
                    {recommendation.deloadReason}
                </div>
            )}

            <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    What To Do Next
                </h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                    {recommendation.actionItems.map((item, i) => (
                        <li key={i}>{item}</li>
                    ))}
                </ul>
            </div>

            <div className="pt-2">
                <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={pdfState === 'loading'}
                    className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                >
                    {pdfState === 'loading' ? 'Preparing...' : 'Download PDF'}
                </button>
                {pdfState === 'error' && (
                    <p className="mt-2 text-sm text-ink/60">
                        PDF isn't ready yet — check back in a moment.
                    </p>
                )}
            </div>
        </div>
    )
}