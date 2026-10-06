'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { logBodyWeight, savePeriodNote } from '@/app/(app)/dashboard/period-actions'
import { toStorageKg, toDisplayWeight, type WeightUnit } from '@/lib/weight-unit'
import type { Period } from '@/lib/periods'

interface PeriodLogCardProps {
    language: string
    latestWeightKg: number | null
    weightUnit: WeightUnit
    // null when a custom cycle hasn't started yet: weight can still be logged, notes can't
    period: Period | null
    initialNote: string
}

type Feedback = { success: boolean; message: string } | null

// Weight and the period note are saved independently, any day of the period.
// The report itself is generated automatically once the period ends.
export function PeriodLogCard({ language, latestWeightKg, weightUnit, period, initialNote }: PeriodLogCardProps) {
    const t = useTranslations('periodLog')
    const zh = language === 'zh-TW'

    const [weightDisplay, setWeightDisplay] = useState(
        latestWeightKg ? String(toDisplayWeight(latestWeightKg, weightUnit)) : ''
    )
    const [note, setNote] = useState(initialNote)
    const [savedNote, setSavedNote] = useState(initialNote)
    const [savingWeight, setSavingWeight] = useState(false)
    const [savingNote, setSavingNote] = useState(false)
    const [weightFeedback, setWeightFeedback] = useState<Feedback>(null)
    const [noteFeedback, setNoteFeedback] = useState<Feedback>(null)

    async function handleWeightSubmit(e: React.FormEvent) {
        e.preventDefault()
        const weightNum = Number(weightDisplay)
        if (!weightDisplay || !(weightNum > 0)) {
            setWeightFeedback({ success: false, message: t('weightError') })
            return
        }
        setSavingWeight(true)
        setWeightFeedback(null)
        const result = await logBodyWeight(toStorageKg(weightNum, weightUnit))
        setSavingWeight(false)
        setWeightFeedback(result.success ? { success: true, message: t('weightSaved') } : { success: false, message: result.message ?? '' })
    }

    async function handleNoteSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSavingNote(true)
        setNoteFeedback(null)
        const result = await savePeriodNote(note)
        setSavingNote(false)
        if (result.success) setSavedNote(note.trim())
        setNoteFeedback(result.success ? { success: true, message: t('noteSaved') } : { success: false, message: result.message ?? '' })
    }

    const placeholder = weightUnit === 'kg'
        ? (zh ? '體重（公斤）' : 'Weight (kg)')
        : (zh ? '體重（磅）' : 'Weight (lb)')

    const buttonClass =
        'rounded-md bg-plate dark:bg-white px-4 py-2 font-display uppercase tracking-wide text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity disabled:opacity-50'

    return (
        <div className="rounded-xl border border-ink/10 bg-white p-4 space-y-4">
            <div className="space-y-1">
                <h2 className="text-lg font-semibold uppercase tracking-wide">{t('title')}</h2>
                {period && (
                    <p className="text-sm text-ink/60">
                        {t('reportSchedule', { end: formatPeriodDate(period.periodEnd, language) })}
                    </p>
                )}
            </div>

            <form onSubmit={handleWeightSubmit} className="space-y-1">
                <label className="text-sm font-medium">{t('weightLabel')}</label>
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
                    <button type="submit" disabled={savingWeight} className={buttonClass}>
                        {savingWeight ? t('saving') : t('logWeight')}
                    </button>
                </div>
                {weightFeedback && (
                    <p className={`text-sm ${weightFeedback.success ? 'text-green-700' : 'text-red-600'}`}>
                        {weightFeedback.message}
                    </p>
                )}
            </form>

            {period && (
                <form onSubmit={handleNoteSubmit} className="space-y-1">
                    <label className="text-sm font-medium">{t('noteLabel')}</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        placeholder={t('notePlaceholder')}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-ink/40">{t('noteHint')}</p>
                        <button
                            type="submit"
                            disabled={savingNote || note.trim() === savedNote}
                            className={buttonClass}
                        >
                            {savingNote ? t('saving') : t('saveNote')}
                        </button>
                    </div>
                    {noteFeedback && (
                        <p className={`text-sm ${noteFeedback.success ? 'text-green-700' : 'text-red-600'}`}>
                            {noteFeedback.message}
                        </p>
                    )}
                </form>
            )}
        </div>
    )
}

function formatPeriodDate(dateIso: string, language: string): string {
    // Noon UTC keeps the calendar date the same in every time zone
    return new Date(`${dateIso}T12:00:00Z`).toLocaleDateString(language === 'zh-TW' ? 'zh-TW' : 'en-US', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'UTC',
    })
}
