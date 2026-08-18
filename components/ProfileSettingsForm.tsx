'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ProfileSettingsFormProps {
    userId: string
    initialHeightCm: number | null
    initialTrainingGoal: string | null
}

export function ProfileSettingsForm({
    userId,
    initialHeightCm,
    initialTrainingGoal,
}: ProfileSettingsFormProps) {
    const supabase = createClient()
    const [heightCm, setHeightCm] = useState(initialHeightCm?.toString() ?? '')
    const [trainingGoal, setTrainingGoal] = useState(initialTrainingGoal ?? '')
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState<string | null>(null)

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        setIsSaving(true)
        setSaveMessage(null)

        const { error } = await supabase.from('user_profiles').upsert(
            {
                user_id: userId,
                height_cm: heightCm ? Number(heightCm) : null,
                training_goal: trainingGoal.trim() || null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        )

        setIsSaving(false)

        if (error) {
            setSaveMessage(`Failed to save: ${error.message}`)
            return
        }

        setSaveMessage('Saved!')
    }

    return (
        <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
                <label htmlFor="heightCm" className="text-sm font-medium">
                    Height (cm)
                </label>
                <input
                    id="heightCm"
                    type="number"
                    step="0.1"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            <div className="space-y-1">
                <label htmlFor="trainingGoal" className="text-sm font-medium">
                    Long-term training goal
                </label>
                <textarea
                    id="trainingGoal"
                    value={trainingGoal}
                    onChange={(e) => setTrainingGoal(e.target.value)}
                    placeholder="e.g. Focus on building back thickness and overall strength"
                    rows={3}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            {saveMessage && (
                <p className="text-sm text-gray-600">{saveMessage}</p>
            )}

            <button
                type="submit"
                disabled={isSaving}
                className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
            >
                {isSaving ? 'Saving...' : 'Save'}
            </button>
        </form>
    )
}