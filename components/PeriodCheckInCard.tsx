'use client'

import { useState } from 'react'
import { submitPeriodCheckIn } from '@/app/(app)/dashboard/checkin-actions'

export function PeriodCheckInCard() {
    const [weightKg, setWeightKg] = useState('')
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const weightNum = Number(weightKg)
        if (!weightKg || weightNum <= 0) {
            setResult({ success: false, message: 'Enter a valid weight.' })
            return
        }

        setIsSubmitting(true)
        setResult(null)
        const response = await submitPeriodCheckIn(weightNum, note.trim() || undefined)
        setResult(response)
        setIsSubmitting(false)
        if (response.success) {
            setWeightKg('')
            setNote('')
        }
    }

    return (
        <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm">
            <h2 className="text-lg font-semibold uppercase tracking-wide">Period Check-In</h2>
            <p className="text-sm text-ink/60">
                Log your weight to close out this period and generate your report.
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
                <div className="flex gap-2">
                    <input
                        type="number"
                        step="0.1"
                        placeholder="Weight (kg)"
                        value={weightKg}
                        onChange={(e) => setWeightKg(e.target.value)}
                        className="flex-1 rounded-md border px-3 py-2 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                    >
                        {isSubmitting ? 'Submitting...' : 'Check In'}
                    </button>
                </div>

                <div className="space-y-1">
                    <label htmlFor="periodNote" className="text-sm font-medium">
                        Anything you want to tell your AI coach this period? (optional)
                    </label>
                    <textarea
                        id="periodNote"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="e.g. My shoulder felt tight this week, or I want to focus more on legs..."
                        className="w-full rounded-md border px-3 py-2 text-sm"
                    />
                </div>
            </form>

            {result && (
                <p className={`text-sm ${result.success ? 'text-green-700' : 'text-ink/60'}`}>
                    {result.message}
                </p>
            )}
        </div>
    )
}