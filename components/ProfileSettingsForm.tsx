'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { setLanguageCookie } from '@/lib/set-language-cookie'
import { OnboardingModal } from '@/components/OnboardingModal'

interface ProfileSettingsFormProps {
    userId: string
    initialHeightCm: number | null
    initialDisplayName: string | null
    initialTrainingGoal: string | null
    initialDateOfBirth: string | null
    initialSex: string | null
    initialTimezone: string
    initialLanguage: string
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
    initialLanguage,
}: ProfileSettingsFormProps) {
    const supabase = createClient()
    const [heightCm, setHeightCm] = useState(initialHeightCm?.toString() ?? '')
    const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
    const [trainingGoal, setTrainingGoal] = useState(initialTrainingGoal ?? '')
    const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth ?? '')
    const [sex, setSex] = useState(initialSex ?? '')
    const [timezone, setTimezone] = useState(initialTimezone)
    const [language, setLanguage] = useState(initialLanguage)
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState<string | null>(null)
    const [showOnboarding, setShowOnboarding] = useState(false)

    const isZhTW = language === 'zh-TW'

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
                language: language as string,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        )

        if (!error) {
            await setLanguageCookie(language)
        }

        setIsSaving(false)
        setSaveMessage(
            error
                ? (isZhTW ? `儲存失敗：${error.message}` : `Failed to save: ${error.message}`)
                : (isZhTW ? '已儲存！' : 'Saved!')
        )
    }

    return (
        <>
            <form onSubmit={handleSave} className="space-y-4">
                <Field label={isZhTW ? '顯示名稱' : 'Display name'}>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={isZhTW ? '你想怎麼被稱呼？' : 'What should we call you?'}
                        className="w-full rounded-md border px-3 py-2"
                    />
                </Field>

                <Field label={isZhTW ? '身高（公分）' : 'Height (cm)'}>
                    <input
                        type="number"
                        step="0.1"
                        value={heightCm}
                        onChange={(e) => setHeightCm(e.target.value)}
                        className="w-full rounded-md border px-3 py-2"
                    />
                </Field>

                <Field label={isZhTW ? '出生日期' : 'Date of birth'}>
                    <input
                        type="date"
                        value={dateOfBirth}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                        className="w-full rounded-md border px-3 py-2"
                    />
                </Field>

                <Field label={isZhTW ? '性別' : 'Sex'}>
                    <select
                        value={sex}
                        onChange={(e) => setSex(e.target.value)}
                        className="w-full rounded-md border px-3 py-2"
                    >
                        <option value="">{isZhTW ? '不想說' : 'Prefer not to say'}</option>
                        <option value="male">{isZhTW ? '男性' : 'Male'}</option>
                        <option value="female">{isZhTW ? '女性' : 'Female'}</option>
                        <option value="other">{isZhTW ? '其他' : 'Other'}</option>
                    </select>
                </Field>

                <Field label={isZhTW ? '時區' : 'Timezone'}>
                    <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full rounded-md border px-3 py-2"
                    >
                        {timezoneOptions.map((tz) => (
                            <option key={tz} value={tz}>{tz}</option>
                        ))}
                    </select>
                </Field>

                <Field label={isZhTW ? '語言' : 'Language'}>
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full rounded-md border px-3 py-2"
                    >
                        <option value="en">English</option>
                        <option value="zh-TW">繁體中文</option>
                    </select>
                </Field>

                <Field label={isZhTW ? '長期訓練目標' : 'Long-term training goal'}>
                    <textarea
                        value={trainingGoal}
                        onChange={(e) => setTrainingGoal(e.target.value)}
                        rows={3}
                        placeholder={
                            isZhTW
                                ? '例如：希望加強背部厚度，提升整體力量'
                                : 'e.g. Focus on building back thickness and overall strength'
                        }
                        className="w-full rounded-md border px-3 py-2"
                    />
                </Field>

                {saveMessage && (
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-ink/60">{saveMessage}</p>
                        {(saveMessage === 'Saved!' || saveMessage === '已儲存！') && (
                            <a href="/dashboard" className="text-sm text-plate underline">
                                {isZhTW ? '回到主頁' : 'Back to dashboard'}
                            </a>
                        )}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isSaving}
                    className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
                >
                    {isSaving
                        ? (isZhTW ? '儲存中...' : 'Saving...')
                        : (isZhTW ? '儲存' : 'Save')}
                </button>
            </form>

            <div className="pt-4 border-t border-ink/10">
                <button
                    type="button"
                    onClick={() => setShowOnboarding(true)}
                    className="text-sm text-ink/40 hover:text-ink underline"
                >
                    {isZhTW ? '重新查看使用教學' : 'View app tutorial again'}
                </button>
            </div>

            {showOnboarding && (
                <OnboardingModal
                    userId={userId}
                    language={language}
                    onClose={() => setShowOnboarding(false)}
                />
            )}
        </>
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