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
import { createClient } from '@/lib/supabase/client'
import { toFriendlyError } from '@/lib/friendly-error'

interface WeightEntry {
    id: string
    recordedAt: string
    weightKg: number | null
}

interface WeightSectionProps {
    userId: string
    entries: WeightEntry[]
    language: string
}

export function WeightSection({ userId, entries: initialEntries, language }: WeightSectionProps) {
    const t = useTranslations('metrics')
    const supabase = createClient()
    const zh = language === 'zh-TW'

    const [isOpen, setIsOpen] = useState(false)
    const [entries, setEntries] = useState<WeightEntry[]>(initialEntries)
    const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
    const [weightKg, setWeightKg] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const chartData = entries
        .filter((e) => e.weightKg !== null)
        .map((e) => ({
            label: formatShortDate(e.recordedAt),
            weightKg: e.weightKg as number,
        }))

    const latestWeight = entries.length > 0
        ? entries[entries.length - 1].weightKg
        : null

    async function handleAddEntry(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        const weightNum = Number(weightKg)
        if (!weightKg || weightNum <= 0) {
            setError(zh ? '請輸入有效的體重。' : 'Enter a valid weight.')
            return
        }

        setIsSaving(true)
        try {
            const recordedAt = new Date(`${date}T12:00:00`).toISOString()
            const { data, error: insertError } = await supabase
                .from('body_metrics')
                .insert({ user_id: userId, weight_kg: weightNum, recorded_at: recordedAt })
                .select('id, recorded_at, weight_kg')
                .single()

            if (insertError || !data) throw new Error(toFriendlyError(insertError))

            setEntries((prev) =>
                [...prev, { id: data.id, recordedAt: data.recorded_at, weightKg: data.weight_kg }]
                    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
            )
            setWeightKg('')
        } catch (err) {
            setError(err instanceof Error ? err.message : (zh ? '發生錯誤，請再試一次。' : 'Something went wrong.'))
        } finally {
            setIsSaving(false)
        }
    }

    async function handleDeleteEntry(id: string) {
        const { error: deleteError } = await supabase.from('body_metrics').delete().eq('id', id)
        if (deleteError) { setError(toFriendlyError(deleteError)); return }
        setEntries((prev) => prev.filter((e) => e.id !== id))
    }

    const mostRecentFirst = [...entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))

    return (
        <div className="rounded-2xl border border-ink/10 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                className="flex w-full items-center justify-between p-6 text-left"
            >
                <div>
                    <h2 className="text-lg font-semibold uppercase tracking-wide">{t('weight')}</h2>
                    {latestWeight && (
                        <p className="text-sm text-ink/40 mt-0.5">
                            {zh ? '最近一次' : 'Latest'}: {latestWeight} kg
                        </p>
                    )}
                </div>
                <span className="text-ink/40">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
                <div className="border-t border-ink/10 p-6 space-y-4">
                    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

                    {chartData.length >= 2 ? (
                        <div className="h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                    <CartesianGrid stroke="#2B2B2814" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#2B2B2899' }} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#2B2B2899' }} width={36} domain={['dataMin - 2', 'dataMax + 2']} />
                                    <Tooltip formatter={(value: number) => [`${value} kg`, zh ? '體重' : 'Weight']} />
                                    <Line type="monotone" dataKey="weightKg" stroke="#26241F" strokeWidth={2} dot={{ r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <p className="text-sm text-ink/40">{t('noTrend')}</p>
                    )}

                    <form onSubmit={handleAddEntry} className="flex gap-2">
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="rounded-md border px-3 py-2 text-sm"
                        />
                        <input
                            type="number"
                            step="0.1"
                            placeholder={zh ? '體重（公斤）' : 'Weight (kg)'}
                            value={weightKg}
                            onChange={(e) => setWeightKg(e.target.value)}
                            className="flex-1 rounded-md border px-3 py-2 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="rounded-md bg-plate px-4 py-2 text-sm font-display uppercase tracking-wide text-chalk disabled:opacity-50"
                        >
                            {isSaving ? '...' : (zh ? '記錄' : 'Log')}
                        </button>
                    </form>

                    {mostRecentFirst.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">{t('history')}</p>
                            {mostRecentFirst.slice(0, 10).map((entry) => (
                                <div key={entry.id} className="flex items-center justify-between text-sm">
                                    <span className="text-ink/60">{formatShortDate(entry.recordedAt)}</span>
                                    <div className="flex items-center gap-3">
                                        <span className="font-mono">{entry.weightKg} kg</span>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteEntry(entry.id)}
                                            className="text-ink/30 hover:text-red-600"
                                        >
                                            ×
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function formatShortDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}