'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { submitPeriodCheckIn } from '@/app/(app)/dashboard/checkin-actions'

interface PeriodCheckInCardProps {
    language: string
    latestWeightKg: number | null
}

export function PeriodCheckInCard({ language, latestWeightKg }: PeriodCheckInCardProps) {
    const t = useTranslations('checkin')
    const [weightKg, setWeightKg] = useState(latestWeightKg ? String(latestWeightKg) : '')
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const weightNum = Number(weightKg)
        if (!weightKg || weightNum <= 0) {
            setResult({ success: false, message: t('weightError') })
            return
        }

        setIsSubmitting(true)
        setResult(null)
        const response = await submitPeriodCheckIn(weightNum, note.trim() || undefined)
        setResult(response)
        setIsSubmitting(false)
        if (response.success) {
            setNote('')
            window.dispatchEvent(new Event('period-checkin-success'))
        }
    }

    return (
        <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm">
            <h2 className="text-lg font-semibold uppercase tracking-wide">{t('title')}</h2>
            <p className="text-sm text-ink/60">{t('description')}</p>

            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                    <div className="flex gap-2">
                        <input
                            type="number"
                            step="0.1"
                            placeholder={t('weightPlaceholder')}
                            value={weightKg}
                            onChange={(e) => setWeightKg(e.target.value)}
                            className="flex-1 rounded-md border px-3 py-2 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                        >
                            {isSubmitting ? t('submitting') : t('submit')}
                        </button>
                    </div>
                    {latestWeightKg && (
                        <p className="text-xs text-ink/40">{t('weightHint')}</p>
                    )}
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium">{t('noteLabel')}</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder={t('notePlaceholder')}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                </div>
            </form>

            {result && (
                <p className={`text-sm ${result.success ? 'text-green-700' : 'text-red-600'}`}>
                    {result.message}
                </p>
            )}
        </div>
    )
}