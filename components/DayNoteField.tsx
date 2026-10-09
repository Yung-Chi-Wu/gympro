'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveDayNote } from '@/app/(app)/dashboard/period-actions'

// The day_notes table allows 200 characters, so a week of notes can't drown the report's brief
const DAY_NOTE_MAX = 200

type Feedback = { success: boolean; message: string } | null

// Today's note, at the bottom of today's log: any day, trained or not ("slept badly",
// "right shoulder felt stuck"). The report lines each note up with that day's training.
export function DayNoteField({ initialNote }: { initialNote: string }) {
    const t = useTranslations('periodLog')
    const id = useId()
    const [note, setNote] = useState(initialNote)
    const [saved, setSaved] = useState(initialNote)
    const [saving, setSaving] = useState(false)
    const [feedback, setFeedback] = useState<Feedback>(null)

    // Saving an empty note deletes it, so Delete is the same call
    async function save(text: string) {
        const trimmed = text.trim()
        setSaving(true)
        setFeedback(null)
        const result = await saveDayNote(trimmed)
        setSaving(false)
        if (result.success) {
            setNote(trimmed)
            setSaved(trimmed)
        }
        setFeedback(result.success
            ? { success: true, message: trimmed ? t('dayNoteSaved') : t('dayNoteDeleted') }
            : { success: false, message: result.message ?? '' })
    }

    return (
        <form onSubmit={(e) => { e.preventDefault(); save(note) }} className="space-y-1 border-t border-ink/10 pt-3">
            <label htmlFor={id} className="text-sm font-medium">{t('dayNoteLabel')}</label>
            <textarea
                id={id}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={DAY_NOTE_MAX}
                placeholder={t('dayNotePlaceholder')}
                className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-ink/40">
                    {t('dayNoteHint')} <span className="tabular-nums">{note.length}/{DAY_NOTE_MAX}</span>
                </p>
                <div className="flex shrink-0 items-center gap-3">
                    {saved && (
                        <button
                            type="button"
                            onClick={() => save('')}
                            disabled={saving}
                            className="text-sm text-ink/40 hover:text-red-600 active:opacity-50 disabled:opacity-50"
                        >
                            {t('deleteDayNote')}
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={saving || note.trim() === saved}
                        className="rounded-md bg-plate dark:bg-white px-4 py-2 font-display uppercase tracking-wide text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        {saving ? t('saving') : t('saveDayNote')}
                    </button>
                </div>
            </div>
            {feedback && (
                <p className={`text-sm ${feedback.success ? 'text-green-700' : 'text-red-600'}`}>
                    {feedback.message}
                </p>
            )}
        </form>
    )
}
