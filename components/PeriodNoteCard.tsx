'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { savePeriodNote } from '@/app/(app)/dashboard/period-actions'

type Feedback = { success: boolean; message: string } | null

// A note for the whole period, from before day notes: still editable and still in this
// period's report. The dashboard shows it only while the current period has one; new
// notes are written for the day, in today's log (DayLogFields).
export function PeriodNoteCard({ initialNote }: { initialNote: string }) {
    const t = useTranslations('periodLog')
    const id = useId()
    const [note, setNote] = useState(initialNote)
    const [savedNote, setSavedNote] = useState(initialNote)
    const [saving, setSaving] = useState(false)
    const [feedback, setFeedback] = useState<Feedback>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        setFeedback(null)
        const result = await savePeriodNote(note)
        setSaving(false)
        if (result.success) setSavedNote(note.trim())
        setFeedback(result.success ? { success: true, message: t('noteSaved') } : { success: false, message: result.message ?? '' })
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-line bg-card p-4 md:p-5">
            <label htmlFor={id} className="block text-[15px] font-semibold">{t('periodNoteLabel')}</label>
            <textarea
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                className="w-full rounded-lg border border-line bg-card px-3 py-2 text-base"
            />
            <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] leading-snug text-faint">{t('periodNoteHint')}</p>
                <button
                    type="submit"
                    disabled={saving || note.trim() === savedNote}
                    className="h-11 shrink-0 rounded-lg bg-plate px-5 font-display uppercase tracking-wide text-chalk transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-[#1A1814]"
                >
                    {saving ? t('saving') : t('saveNote')}
                </button>
            </div>
            {feedback && (
                <p role="status" className={`text-sm ${feedback.success ? 'text-good' : 'text-miss'}`}>
                    {feedback.message}
                </p>
            )}
        </form>
    )
}
