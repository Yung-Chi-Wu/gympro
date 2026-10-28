'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { savePeriodNote } from '@/app/(app)/dashboard/period-actions'
import { serverWrite } from '@/lib/data-version'
import { BUTTON } from '@/lib/ui'

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
        const result = await serverWrite(() => savePeriodNote(note))
        setSaving(false)
        if (result.success) setSavedNote(note.trim())
        setFeedback(result.success ? { success: true, message: t('noteSaved') } : { success: false, message: result.message ?? '' })
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-card border border-line bg-card p-4 md:p-5">
            <label htmlFor={id} className="block text-[15px] font-semibold">{t('periodNoteLabel')}</label>
            <textarea
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                className="w-full rounded-field border border-line bg-card px-3 py-2 text-base"
            />
            <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] leading-snug text-faint">{t('periodNoteHint')}</p>
                <button
                    type="submit"
                    disabled={saving || note.trim() === savedNote}
                    className={`${BUTTON.primary} shrink-0`}
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
