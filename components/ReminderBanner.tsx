'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ReminderBannerProps {
    userId: string
    needsWeightLog: boolean
    needsHeightConfirm: boolean
}

export function ReminderBanner({
    userId,
    needsWeightLog,
    needsHeightConfirm,
}: ReminderBannerProps) {
    const supabase = createClient()
    const [weightInput, setWeightInput] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [logged, setLogged] = useState(false)

    if (!needsWeightLog && !needsHeightConfirm) return null

    async function handleLogWeight(e: React.FormEvent) {
        e.preventDefault()
        if (!weightInput) return
        setIsSaving(true)

        const { error } = await supabase.from('body_metrics').insert({
            user_id: userId,
            weight_kg: Number(weightInput),
            recorded_at: new Date().toISOString(),
        })

        setIsSaving(false)
        if (!error) setLogged(true)
    }

    return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            {needsWeightLog && !logged && (
                <form onSubmit={handleLogWeight} className="flex items-center gap-2">
                    <span className="text-sm text-blue-900">
                        Time to log this week's weight:
                    </span>
                    <input
                        type="number"
                        step="0.1"
                        value={weightInput}
                        onChange={(e) => setWeightInput(e.target.value)}
                        placeholder="kg"
                        className="w-20 rounded border px-2 py-1 text-sm"
                    />
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="rounded bg-blue-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                    >
                        Log
                    </button>
                </form>
            )}
            {logged && <p className="text-sm text-blue-900">Weight logged, thanks!</p>}

            {needsHeightConfirm && (
                <p className="text-sm text-blue-900">
                    It's been a while — please confirm your height in{' '}
                    <a href="/settings" className="underline">
                        Settings
                    </a>
                    .
                </p>
            )}
        </div>
    )
}