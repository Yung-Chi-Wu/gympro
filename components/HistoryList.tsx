'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
    PieChart, Pie, Cell,
    Tooltip, ResponsiveContainer,
} from 'recharts'
import { getReportPdfUrl } from '@/app/(app)/dashboard/pdf-actions'
import { WeightTrendCard } from '@/components/WeightTrendCard'
import type { PeriodOption } from '@/app/(app)/history/page'
import type { AiRecommendation } from './types'

interface WeightEntry {
    id: string
    recordedAt: string
    weightKg: number | null
}

interface ReportRow {
    period_start: string
    status: string
    recommendation: unknown
    pdf_status: string | null
    error_message: string | null
    created_at: string
}

interface HistoryListProps {
    userId: string
    periods: PeriodOption[]
    reports: ReportRow[]
    language: string
    weightEntries: WeightEntry[]
}

const CHART_COLORS = ['#26241F', '#8A5A44', '#4A6B5A', '#5A6B8A', '#8A7A44', '#6B4A6B']
const SEVERITY_STYLES: Record<string, string> = {
    mild: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    moderate: 'bg-orange-50 text-orange-800 border-orange-200',
    severe: 'bg-red-50 text-red-800 border-red-200',
}

export function HistoryList({ userId, periods, reports, language, weightEntries }: HistoryListProps) {
    const zh = language === 'zh-TW'
    const reportByPeriodStart = new Map(reports.map((r) => [r.period_start, r]))

    return (
        <div className="space-y-6">
            <WeightTrendCard entries={weightEntries} language={language} />

            {periods.length === 0 ? (
                <p className="text-sm text-ink/60">
                    {zh ? '沒有訓練紀錄。' : 'No training history yet.'}
                </p>
            ) : (
                <div className="space-y-3">
                    {periods.map((period) => (
                        <PeriodRow
                            key={period.start}
                            period={period}
                            report={reportByPeriodStart.get(period.start) ?? null}
                            userId={userId}
                            language={language}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

interface PeriodRowProps {
    period: PeriodOption
    report: ReportRow | null
    userId: string
    language: string
}

function PeriodRow({ period, report, userId, language }: PeriodRowProps) {
    return (
        <div className="rounded-2xl border border-ink/10 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-ink/10 bg-ink/[0.02]">
                <p className="font-semibold text-sm">
                    {formatDateRange(period.start, period.end, language)}
                </p>
            </div>

            <TrainingLogSection
                periodStart={period.start}
                periodEnd={period.end}
                userId={userId}
                language={language}
            />

            <ReportSection report={report} language={language} />
        </div>
    )
}

function TrainingLogSection({
    periodStart,
    periodEnd,
    userId,
    language,
}: {
    periodStart: string
    periodEnd: string
    userId: string
    language: string
}) {
    const zh = language === 'zh-TW'
    const [isOpen, setIsOpen] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [workouts, setWorkouts] = useState<WorkoutDay[]>([])
    const [loading, setLoading] = useState(false)

    async function handleOpen() {
        if (isOpen) { setIsOpen(false); return }
        setIsOpen(true)
        if (loaded) return
        setLoading(true)
        try {
            const res = await fetch(
                `/api/history/workouts?userId=${userId}&start=${periodStart}&end=${periodEnd}`
            )
            const data = await res.json()
            setWorkouts(data.workouts ?? [])
            setLoaded(true)
        } catch {
            setWorkouts([])
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="border-b border-ink/10">
            <button
                type="button"
                onClick={handleOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-sm text-left"
            >
                <span className="font-medium text-ink/70">
                    {zh ? '訓練日誌' : 'Training Log'}
                </span>
                <span className="text-ink/40 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <div className="px-4 pb-4 space-y-3">
                    {loading && (
                        <p className="text-sm text-ink/40">{zh ? '載入中...' : 'Loading...'}</p>
                    )}
                    {!loading && workouts.length === 0 && (
                        <p className="text-sm text-ink/40">
                            {zh ? '這個週期沒有訓練紀錄。' : 'No workouts logged this period.'}
                        </p>
                    )}
                    {!loading && workouts.map((workout) => (
                        <div key={workout.id} className="space-y-1">
                            <p className="text-sm font-medium">
                                {formatDate(workout.performed_at, language)}
                                {workout.title && ` — ${workout.title}`}
                            </p>
                            {workout.exercises.map((ex) => (
                                <div key={ex.exerciseId} className="text-xs text-ink/60 pl-2">
                                    <span className="font-medium">{ex.name}</span>
                                    {ex.sets.length > 0 && (
                                        <>
                                            {': '}
                                            {ex.sets.map((s) => `${s.weightKg}kg×${s.reps}`).join(', ')}
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function ReportSection({ report, language }: { report: ReportRow | null; language: string }) {
    const zh = language === 'zh-TW'
    const t = useTranslations('report')
    const [isOpen, setIsOpen] = useState(false)
    const [showMore, setShowMore] = useState(false)
    const [pdfState, setPdfState] = useState<'idle' | 'loading' | 'error'>('idle')

    async function handleDownloadPdf() {
        if (!report) return
        setPdfState('loading')
        const result = await getReportPdfUrl(report.period_start)
        if (result.success && result.url) {
            window.open(result.url, '_blank', 'noopener,noreferrer')
            setPdfState('idle')
        } else {
            setPdfState('error')
        }
    }

    const isCompleted = report?.status === 'completed'
    const rec = isCompleted ? (report.recommendation as unknown as AiRecommendation) : null

    return (
        <div>
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm text-left"
            >
                <span className="font-medium text-ink/70">
                    {zh ? '訓練報告' : 'Report'}
                    {isCompleted && (
                        <span className="ml-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                            {zh ? '已完成' : 'Ready'}
                        </span>
                    )}
                </span>
                <span className="text-ink/40 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <div className="px-4 pb-4 space-y-4">
                    {!report && (
                        <p className="text-sm text-ink/40">
                            {zh ? '這個週期沒有打卡紀錄。' : 'No check-in for this period.'}
                        </p>
                    )}

                    {report?.status === 'pending' && (
                        <div className="flex items-center gap-2 text-sm text-ink/60">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                            {zh ? '報告生成中...' : 'Report is being generated...'}
                        </div>
                    )}

                    {report?.status === 'insufficient_data' && (
                        <p className="text-sm text-ink/60">{report.error_message}</p>
                    )}

                    {report?.status === 'failed' && (
                        <p className="text-sm text-red-600">
                            {zh ? '報告生成失敗。' : 'Report generation failed.'}
                        </p>
                    )}

                    {isCompleted && rec && (
                        <div className="space-y-4">
                            <p className="font-medium text-sm">{rec.headline}</p>

                            {!showMore ? (
                                <button
                                    type="button"
                                    onClick={() => setShowMore(true)}
                                    className="text-sm text-plate underline"
                                >
                                    {t('readMore')}
                                </button>
                            ) : (
                                <div className="space-y-4">
                                    {Object.keys(rec.volumeSplit ?? {}).length > 0 && (
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-2">
                                                {t('trainingSplit')}
                                            </p>
                                            <div className="h-36">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie
                                                            data={Object.entries(rec.volumeSplit).map(([name, value]) => ({ name, value }))}
                                                            dataKey="value"
                                                            nameKey="name"
                                                            outerRadius={50}
                                                        >
                                                            {Object.entries(rec.volumeSplit).map((_, i) => (
                                                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <Tooltip formatter={(value: number) => `${value}%`} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-1">
                                            {t('summary')}
                                        </p>
                                        <p className="text-sm text-gray-700">{rec.summary}</p>
                                    </div>

                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-1">
                                            {t('progressiveOverload')}
                                        </p>
                                        <p className="text-sm text-gray-600">{rec.progressiveOverload.notes}</p>
                                    </div>

                                    {rec.muscleImbalances.length > 0 && (
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-2">
                                                {t('thingsToWatch')}
                                            </p>
                                            <div className="space-y-2">
                                                {rec.muscleImbalances.map((item, i) => (
                                                    <div
                                                        key={i}
                                                        className={`rounded border px-3 py-2 text-sm ${SEVERITY_STYLES[item.severity] ?? ''}`}
                                                    >
                                                        <span className="font-semibold capitalize">{item.muscleGroup}</span>
                                                        {' — '}
                                                        {item.observation}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {rec.deloadRecommended && (
                                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                            <span className="font-semibold">{t('deloadRecommended')} </span>
                                            {rec.deloadReason}
                                        </div>
                                    )}

                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-ink/40 mb-2">
                                            {t('whatToDoNext')}
                                        </p>
                                        <ul className="list-disc list-inside space-y-1 text-sm">
                                            {rec.actionItems.map((item, i) => (
                                                <li key={i}>{item}</li>
                                            ))}
                                        </ul>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setShowMore(false)}
                                        className="text-sm text-ink/40 underline"
                                    >
                                        {t('showLess')}
                                    </button>
                                </div>
                            )}

                            {report.pdf_status === 'completed' && (
                                <div>
                                    <button
                                        type="button"
                                        onClick={handleDownloadPdf}
                                        disabled={pdfState === 'loading'}
                                        className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                                    >
                                        {pdfState === 'loading' ? t('preparing') : t('downloadPdf')}
                                    </button>
                                    {pdfState === 'error' && (
                                        <p className="mt-1 text-xs text-ink/60">{t('pdfNotReady')}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

interface WorkoutDay {
    id: string
    title: string | null
    performed_at: string
    exercises: {
        exerciseId: string
        name: string
        sets: { reps: number; weightKg: number }[]
    }[]
}

function formatDateRange(start: string, end: string, language: string): string {
    const fmt = (d: string) => new Date(d).toLocaleDateString(
        language === 'zh-TW' ? 'zh-TW' : 'en-US',
        { month: 'short', day: 'numeric' }
    )
    return `${fmt(start)} – ${fmt(end)}`
}

function formatDate(dateString: string, language: string): string {
    return new Date(dateString).toLocaleDateString(
        language === 'zh-TW' ? 'zh-TW' : 'en-US',
        { weekday: 'short', month: 'short', day: 'numeric' }
    )
}