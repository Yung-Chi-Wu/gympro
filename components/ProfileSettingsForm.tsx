'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { setLanguageCookie } from '@/lib/set-language-cookie'
import type { WeightUnit } from '@/lib/weight-unit'
import { DeleteAccountButton } from '@/components/DeleteAccountButton'
import { ThemeSelector } from '@/components/ThemeSelector'
import { useTheme } from 'next-themes'


interface ProfileSettingsFormProps {
    userId: string
    initialHeightCm: number | null
    initialDisplayName: string | null
    initialTrainingGoal: string | null
    initialDateOfBirth: string | null
    initialSex: string | null
    initialTimezone: string
    initialLanguage: string
    initialWeightUnit: WeightUnit
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
    initialWeightUnit,
}: ProfileSettingsFormProps) {
    const supabase = createClient()
    const [heightCm, setHeightCm] = useState(initialHeightCm?.toString() ?? '')
    const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
    const [trainingGoal, setTrainingGoal] = useState(initialTrainingGoal ?? '')
    const [dateOfBirth, setDateOfBirth] = useState(initialDateOfBirth ?? '')
    const [sex, setSex] = useState(initialSex ?? '')
    const [timezone, setTimezone] = useState(initialTimezone)
    const [language, setLanguage] = useState(initialLanguage)
    const [weightUnit, setWeightUnit] = useState<WeightUnit>(initialWeightUnit)
    const [isSaving, setIsSaving] = useState(false)
    const [saveMessage, setSaveMessage] = useState<string | null>(null)
    const [showOnboarding, setShowOnboarding] = useState(false)
    const { theme, setTheme } = useTheme()
    const [selectedTheme, setSelectedTheme] = useState(theme ?? 'system')

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
                weight_unit: weightUnit,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
        )

        if (!error) {
            await setLanguageCookie(language)
            setTheme(selectedTheme)
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
                        type="text"
                        inputMode="decimal"
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

                <Field label={isZhTW ? '性別' : 'Gender'}>
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
                <Field label={isZhTW ? '顯示模式' : 'Display Mode'}>
                    <ThemeSelector
                        isZhTW={isZhTW}
                        value={selectedTheme}
                        onChange={setSelectedTheme}
                    />
                </Field>

                <Field label={isZhTW ? '重量單位' : 'Weight Unit'}>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => setWeightUnit('kg')}
                            className={`flex-1 rounded-xl border-2 py-2 text-sm font-semibold transition-colors ${weightUnit === 'kg'
                                ? 'border-plate bg-plate text-chalk'
                                : 'border-ink/20 text-ink/60'
                                }`}
                        >
                            kg
                        </button>
                        <button
                            type="button"
                            onClick={() => setWeightUnit('lb')}
                            className={`flex-1 rounded-xl border-2 py-2 text-sm font-semibold transition-colors ${weightUnit === 'lb'
                                ? 'border-plate bg-plate text-chalk'
                                : 'border-ink/20 text-ink/60'
                                }`}
                        >
                            lb
                        </button>
                    </div>
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
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#C8955A]/10 dark:bg-[#C8955A]/15 border border-[#C8955A]/30 px-3 py-2">
                        <span className="text-base shrink-0">💡</span>
                        <p className="text-xs text-[#8A5A30] dark:text-[#C8955A] font-medium">
                            {isZhTW
                                ? '設定目標後，AI 教練會根據你的目標給出更精準的建議。'
                                : 'Setting a goal helps your AI coach give more targeted advice.'}
                        </p>
                    </div>
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
                    className="rounded-md bg-plate px-4 py-2 text-chalk font-medium disabled:opacity-50 hover:bg-plate-light transition-colors"
                >
                    {isSaving
                        ? (isZhTW ? '儲存中...' : 'Saving...')
                        : (isZhTW ? '儲存' : 'Save')}
                </button>
            </form>

            <div className="pt-4 border-t border-ink/10 space-y-4">
                <button
                    type="button"
                    onClick={() => setShowOnboarding(true)}
                    className="text-sm text-ink/40 hover:text-ink underline"
                >
                    {isZhTW ? '重新查看使用教學' : 'View app tutorial again'}
                </button>

                <div className="rounded-xl bg-ink/5 p-4 space-y-3">
                    <p className="text-sm font-semibold">
                        {isZhTW ? '📱 加到主畫面' : '📱 Add to Home Screen'}
                    </p>
                    <div className="space-y-2">
                        <div className="flex items-start gap-3">
                            <span className="text-lg shrink-0">⬆️</span>
                            <p className="text-xs text-ink/60">
                                {isZhTW
                                    ? '點 Safari 底部工具列中間的分享按鈕（方框加箭頭）'
                                    : "Tap the Share button in Safari's toolbar (box with arrow)"}
                            </p>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="text-lg shrink-0">➕</span>
                            <p className="text-xs text-ink/60">
                                {isZhTW ? '選「加入主畫面」' : 'Select "Add to Home Screen"'}
                            </p>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="text-lg shrink-0">✅</span>
                            <p className="text-xs text-ink/60">
                                {isZhTW ? '點右上角「新增」完成' : 'Tap "Add" to finish'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <DeleteAccountButton isZhTW={isZhTW} />
            {showOnboarding && (
                <OnboardingModalWrapper
                    userId={userId}
                    language={language}
                    onClose={() => setShowOnboarding(false)}
                />
            )}
        </>
    )
}

function OnboardingModalWrapper({
    userId,
    language,
    onClose,
}: {
    userId: string
    language: string
    onClose: () => void
}) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OnboardingModal } = require('@/components/OnboardingModal')
    return <OnboardingModal userId={userId} language={language} onClose={onClose} />
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <label className="text-sm font-medium text-ink">{label}</label>
            {children}
        </div>
    )
}