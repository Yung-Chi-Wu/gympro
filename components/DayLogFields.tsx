'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveDayNote, saveDayWeight } from '@/app/(app)/dashboard/period-actions'
import { toDisplayWeight, toStorageKg, type WeightUnit } from '@/lib/weight-unit'

// The day_notes table allows 200 characters, so a week of notes can't drown the report's brief
const DAY_NOTE_MAX = 200
// The counter shows only near the limit, so it doesn't crowd the hint
const COUNTER_FROM = DAY_NOTE_MAX - 40

type Feedback = { success: boolean; message: string } | null

interface DayLogFieldsProps {
    /** Today's weigh-in, if there is one */
    initialWeightKg: number | null
    /** The last weigh-in before today: a grey hint in the empty box, like last time's sets */
    lastWeightKg: number | null
    initialNote: string
    /** The reading unit (Settings) */
    weightUnit: WeightUnit
}

// Today's weight and note, at the bottom of today's log: both optional, on any day, trained
// or not. One of each a day: saving again replaces it, and saving it empty deletes it. The
// report lines them up with that day's training.
export function DayLogFields({ initialWeightKg, lastWeightKg, initialNote, weightUnit }: DayLogFieldsProps) {
    const t = useTranslations('dayLog')
    const weightId = useId()
    const noteId = useId()
    const shown = (kg: number | null) => (kg == null ? '' : String(toDisplayWeight(kg, weightUnit)))
    const [weight, setWeight] = useState(shown(initialWeightKg))
    const [note, setNote] = useState(initialNote)
    const [saved, setSaved] = useState({ weight: shown(initialWeightKg), note: initialNote })
    const [saving, setSaving] = useState(false)
    const [feedback, setFeedback] = useState<Feedback>(null)
    const weightChanged = weight.trim() !== saved.weight
    const noteChanged = note.trim() !== saved.note

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const w = weight.trim()
        const n = note.trim()
        if (weightChanged && w && !(Number(w) > 0)) {
            setFeedback({ success: false, message: t('weightInvalid') })
            return
        }
        setSaving(true)
        setFeedback(null)
        const [weightResult, noteResult] = await Promise.all([
            weightChanged ? saveDayWeight(w ? toStorageKg(Number(w), weightUnit) : null) : null,
            noteChanged ? saveDayNote(n) : null,
        ])
        setSaving(false)
        setSaved((prev) => ({
            weight: weightResult?.success ? w : prev.weight,
            note: noteResult?.success ? n : prev.note,
        }))
        if (noteResult?.success) setNote(n)
        const failed = [weightResult, noteResult].find((r) => r && !r.success)
        setFeedback(failed ? { success: false, message: failed.message ?? '' } : { success: true, message: t('saved') })
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-line pt-4">
            <h3 className="text-[15px] font-semibold">{t('title')}</h3>

            <div className="flex items-center gap-3">
                <label htmlFor={weightId} className="w-10 shrink-0 text-sm text-muted">{t('weight')}</label>
                <div className="relative w-36">
                    <input
                        id={weightId}
                        type="text"
                        inputMode="decimal"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        placeholder={shown(lastWeightKg)}
                        className="h-11 w-full rounded-lg border border-line bg-card px-3 pr-10 font-mono text-base font-bold placeholder:font-medium placeholder:text-faint"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-faint">{weightUnit}</span>
                </div>
            </div>

            <div className="flex gap-3">
                <label htmlFor={noteId} className="w-10 shrink-0 pt-2.5 text-sm text-muted">{t('note')}</label>
                <textarea
                    id={noteId}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={DAY_NOTE_MAX}
                    placeholder={t('notePlaceholder')}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-base placeholder:text-faint"
                />
            </div>

            <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] leading-snug text-faint">
                    {t('hint')}
                    {note.length >= COUNTER_FROM && <span className="ml-1 font-mono">{note.length}/{DAY_NOTE_MAX}</span>}
                </p>
                <button
                    type="submit"
                    disabled={saving || (!weightChanged && !noteChanged)}
                    className="h-11 shrink-0 rounded-lg bg-plate px-5 font-display uppercase tracking-wide text-chalk transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-[#1A1814]"
                >
                    {saving ? t('saving') : t('save')}
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
