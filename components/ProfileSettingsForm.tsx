'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ProfileSettingsFormProps {
    userId: string
    initialHeightCm: number | null
    initialDisplayName: string | null
    initialTrainingGoal: string | null
    initialDateOfBirth: string | null
    initialSex: string | null
    initialTimezone: string
}

const COMMON_TIMEZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Taipei',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Europe/London',
    'Europe/Paris',
    'Australia/Sydney',
]

export function ProfileSettingsForm({
    userId,
    initialHeightCm,
    initialDisplayName,
    initialTrainingGoal,
    initialDateOfBirth,
    initialSex,
    initialTimezone,
}: ProfileSettingsFormProps) {
    const supabase = createClient()
    const [heightCm, setHeightCm] = useState(initialHeightCm?.toString() ?? '')
    const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
    const [trainingGoal, setTrainingGoal] = useState(initialTrainingGoal ?? '')
    const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth ?? '')
    const [sex, setSex] = useState(initialSex ?? '')
    const [timezone, setTimezone] = useState(initialTimezone)
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState<string | null>(null)

    // Browser timezones not in our curated list still need to show up
    // (e.g. someone whose system timezone is Asia/Taipei but who picked
    // something else before) — always keep the current value selectable.
    const timezoneOptions = COMMON_TIMEZONES.includes(timezone)
        ? COMMON_TIMEZONES
        : [timezone, ...COMMON_TIMEZONES]

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        setIsSaving(true)
        setSaveMessage(null)

        const { error } = await supabase.from('user_profiles').upsert(
            {
                user_id: userId,
                height_cm: heightCm ? Number(heightCm) : null,
                display_name: displayName.trim() || null,
                height_updated_at: heightCm ? new Date().toISOString() : null,
                date_of_birth: dateOfBirth || null,
                sex: sex || null,
                training_goal: trainingGoal.trim() || null,
                timezone,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        )

        setIsSaving(false)
        setSaveMessage(error ? `Failed to save: ${error.message}` : 'Saved!')
    }

    return (
        <form onSubmit={handleSave} className="space-y-4">
            <Field label="Display name">
                <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="What should we call you?"
                    className="w-full rounded-md border px-3 py-2"
                />
            </Field>

            <Field label="Height (cm)">
                <input
                    type="number"
                    step="0.1"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </Field>

            <Field label="Date of birth">
                <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </Field>

            <Field label="Sex">
                <select
                    value={sex}
                    onChange={(e) => setSex(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                >
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                </select>
            </Field>

            <Field label="Timezone">
                <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                >
                    {timezoneOptions.map((tz) => (
                        <option key={tz} value={tz}>
                            {tz}
                        </option>
                    ))}
                </select>
            </Field>

            <Field label="Long-term training goal">
                <textarea
                    value={trainingGoal}
                    onChange={(e) => setTrainingGoal(e.target.value)}
                    rows={3}
                    placeholder="e.g. Focus on building back thickness and overall strength"
                    className="w-full rounded-md border px-3 py-2"
                />
            </Field>

            {saveMessage && (
                <div className="flex items-center gap-3">
                    <p className="text-sm text-ink/60">{saveMessage}</p>
                    {saveMessage === 'Saved!' && (
                        <a href="/dashboard" className="text-sm text-plate underline">
                            Back to dashboard
                        </a>
                    )}
                </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <label className="text-sm font-medium">{label}</label>
            {children}
        </div>
    )
}