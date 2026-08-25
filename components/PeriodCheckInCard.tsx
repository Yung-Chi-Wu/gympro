'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { submitPeriodCheckIn } from '@/app/(app)/dashboard/checkin-actions'
import { toStorageKg, toDisplayWeight, type WeightUnit } from '@/lib/weight-unit'

interface PeriodCheckInCardProps {
    language: string
    latestWeightKg: number | null
    weightUnit: WeightUnit
}

export function PeriodCheckInCard({ language, latestWeightKg, weightUnit }: PeriodCheckInCardProps) {
    const t = useTranslations('checkin')
    const zh = language === 'zh-TW'

    const initialDisplay = latestWeightKg
        ? String(toDisplayWeight(latestWeightKg, weightUnit))
        : ''

    const [weightDisplay, setWeightDisplay] = useState(initialDisplay)
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const weightNum = Number(weightDisplay)
        if (!weightDisplay || weightNum <= 0) {
            setResult({ success: false, message: t('weightError') })
            return
        }

        const weightKg = toStorageKg(weightNum, weightUnit)

        setIsSubmitting(true)
        setResult(null)
        const response = await submitPeriodCheckIn(weightKg, note.trim() || undefined)
        setResult(response)
        setIsSubmitting(false)
        if (response.success) {
            setNote('')
            window.dispatchEvent(new Event('period-checkin-success'))
        }
    }

    const placeholder = weightUnit === 'kg'
        ? (zh ? '體重（公斤）' : 'Weight (kg)')
        : (zh ? '體重（磅）' : 'Weight (lb)')

    return (
        <div className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3 shadow-sm">
            <h2 className="text-lg font-semibold uppercase tracking-wide">{t('title')}</h2>
            <p className="text-sm text-ink/60">{t('description')}</p>

            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder={placeholder}
                                value={weightDisplay}
                                onChange={(e) => setWeightDisplay(e.target.value)}
                                className="w-full rounded-md border px-3 py-2 pr-10 text-sm"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink/40 font-medium">
                                {weightUnit}
                            </span>
                        </div>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-md bg-plate dark:bg-white px-4 py-2 font-display uppercase tracking-wide text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity disabled:opacity-50"
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