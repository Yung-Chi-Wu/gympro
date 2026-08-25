'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from 'next-themes'
import type { WeightUnit } from '@/lib/weight-unit'

interface OnboardingModalProps {
    userId: string
    language: string
    onClose?: () => void
}

export function OnboardingModal({ userId, language, onClose }: OnboardingModalProps) {
    const supabase = createClient()
    const { setTheme } = useTheme()

    const [step, setStep] = useState(0)
    const [visible, setVisible] = useState(true)

    // Selections
    const [selectedLang, setSelectedLang] = useState(language)
    const [selectedUnit, setSelectedUnit] = useState<WeightUnit>('kg')
    const [selectedTheme, setSelectedTheme] = useState('system')

    // Profile fields (all optional)
    const [displayName, setDisplayName] = useState('')
    const [sex, setSex] = useState('')
    const [dateOfBirth, setDateOfBirth] = useState('')
    const [heightCm, setHeightCm] = useState('')

    const zh = selectedLang === 'zh-TW'

    const STEPS = [
        'lang',
        'theme',
        'unit',
        'profile',
        'routines',
        'log',
        'checkin',
        'report',
        'pwa',
    ]

    const isLast = step === STEPS.length - 1
    const isFirst = step === 0
    const canSkip = step >= 3 // lang/theme/unit 不能跳過，profile 之後可以

    async function handleFinish() {
        if (onClose) {
            onClose()
            setVisible(false)
            return
        }

        const updates: Record<string, unknown> = {
            onboarding_completed: true,
            weight_unit: selectedUnit,
            language: selectedLang,
        }

        if (displayName.trim()) updates.display_name = displayName.trim()
        if (sex) updates.sex = sex
        if (dateOfBirth) updates.date_of_birth = dateOfBirth
        if (heightCm) updates.height_cm = Number(heightCm)

        await supabase
            .from('user_profiles')
            .update(updates as never)
            .eq('user_id', userId)

        document.cookie = `language=${selectedLang}; path=/; max-age=${60 * 60 * 24 * 365}`
        localStorage.setItem('onboarding_completed', 'true')
        setTheme(selectedTheme)

        window.location.href = '/dashboard'
    }

    if (!visible) return null

    const currentStep = STEPS[step]

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-0">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-5">

                {/* Progress dots */}
                <div className="flex justify-center gap-1.5">
                    {STEPS.map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-[#26241F]' : i < step ? 'w-1.5 bg-[#26241F]/30' : 'w-1.5 bg-black/10'
                            }`} />
                    ))}
                </div>

                {/* ── Step content ── */}

                {currentStep === 'lang' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">🌐</div>
                            <h2 className="text-xl font-bold text-[#1A1814]">Language / 語言</h2>
                        </div>
                        <div className="flex gap-3">
                            {['en', 'zh-TW'].map((lang) => (
                                <button key={lang} type="button" onClick={() => setSelectedLang(lang)}
                                    className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedLang === lang
                                            ? 'border-[#26241F] bg-[#26241F] text-white'
                                            : 'border-black/10 text-black/50'
                                        }`}>
                                    {lang === 'en' ? 'English' : '繁體中文'}
                                </button>
                            ))}
                        </div>
                        <p className="text-center text-xs text-black/40">
                            {selectedLang === 'zh-TW' ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                        </p>
                    </div>
                )}

                {currentStep === 'theme' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">🌓</div>
                            <h2 className="text-xl font-bold text-[#1A1814]">
                                {zh ? '顯示模式' : 'Display Mode'}
                            </h2>
                            <p className="text-sm text-black/50">
                                {zh ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {[
                                { value: 'system', zh: '系統', en: 'System' },
                                { value: 'light', zh: '日間', en: 'Light' },
                                { value: 'dark', zh: '夜間', en: 'Dark' },
                            ].map((opt) => (
                                <button key={opt.value} type="button" onClick={() => setSelectedTheme(opt.value)}
                                    className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedTheme === opt.value
                                            ? 'border-[#26241F] bg-[#26241F] text-white'
                                            : 'border-black/10 text-black/50'
                                        }`}>
                                    {zh ? opt.zh : opt.en}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {currentStep === 'unit' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">⚖️</div>
                            <h2 className="text-xl font-bold text-[#1A1814]">
                                {zh ? '選擇重量單位' : 'Choose Weight Unit'}
                            </h2>
                            <p className="text-sm text-black/50">
                                {zh ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                            </p>
                        </div>
                        <div className="flex gap-3">
                            {(['kg', 'lb'] as WeightUnit[]).map((unit) => (
                                <button key={unit} type="button" onClick={() => setSelectedUnit(unit)}
                                    className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedUnit === unit
                                            ? 'border-[#26241F] bg-[#26241F] text-white'
                                            : 'border-black/10 text-black/50'
                                        }`}>
                                    {unit}
                                    <span className="block text-xs font-normal mt-0.5">
                                        {unit === 'kg' ? (zh ? '公斤' : 'Kilogram') : (zh ? '磅' : 'Pound')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {currentStep === 'profile' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-1">
                            <div className="text-4xl">👤</div>
                            <h2 className="text-xl font-bold text-[#1A1814]">
                                {zh ? '建立你的個人檔案' : 'Your Profile'}
                            </h2>
                            <p className="text-xs text-black/40">
                                {zh ? '這些資訊幫助 AI 給你更準確的建議（全部選填）' : 'Helps AI give better advice — all optional'}
                            </p>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-black/60 mb-1 block">
                                    {zh ? '暱稱' : 'Display Name'}
                                </label>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder={zh ? '你想怎麼被稱呼？' : 'What should we call you?'}
                                    className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-[#1A1814]"
                                />
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-black/60 mb-1 block">
                                        {zh ? '性別' : 'Gender'}
                                    </label>
                                    <select
                                        value={sex}
                                        onChange={(e) => setSex(e.target.value)}
                                        className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-[#1A1814]"
                                    >
                                        <option value="">{zh ? '不想說' : 'Prefer not to say'}</option>
                                        <option value="male">{zh ? '男性' : 'Male'}</option>
                                        <option value="female">{zh ? '女性' : 'Female'}</option>
                                        <option value="other">{zh ? '其他' : 'Other'}</option>
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-black/60 mb-1 block">
                                        {zh ? '身高 (cm)' : 'Height (cm)'}
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={heightCm}
                                        onChange={(e) => setHeightCm(e.target.value)}
                                        placeholder="175"
                                        className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-[#1A1814]"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-black/60 mb-1 block">
                                    {zh ? '出生日期' : 'Date of Birth'}
                                </label>
                                <input
                                    type="date"
                                    value={dateOfBirth}
                                    onChange={(e) => setDateOfBirth(e.target.value)}
                                    className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-[#1A1814]"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {currentStep === 'routines' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">📋</div>
                        <h2 className="text-xl font-bold text-[#1A1814]">
                            {zh ? '建立你的課表' : 'Build Your Routines'}
                        </h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh
                                ? '前往「訓練課表」新增動作，設定訓練循環——幾天一輪、每天練什麼。'
                                : 'Go to Routines to add exercises and set up your training cycle.'}
                        </p>
                    </div>
                )}

                {currentStep === 'log' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">💪</div>
                        <h2 className="text-xl font-bold text-[#1A1814]">
                            {zh ? '每天記錄訓練' : 'Log Every Day'}
                        </h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh
                                ? '打開主頁的「今天」卡片，把每一組的重量和次數記下來。'
                                : 'Open the Today card and log each set — weight and reps for every exercise.'}
                        </p>
                    </div>
                )}

                {currentStep === 'checkin' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">⚖️</div>
                        <h2 className="text-xl font-bold text-[#1A1814]">
                            {zh ? '週期結束時打卡' : 'Check In at Period End'}
                        </h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh
                                ? '確認體重並打卡，這會觸發 AI 分析你這期的訓練。'
                                : 'Confirm your weight and check in — this triggers your AI analysis.'}
                        </p>
                    </div>
                )}

                {currentStep === 'report' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">🤖</div>
                        <h2 className="text-xl font-bold text-[#1A1814]">
                            {zh ? '閱讀 AI 教練報告' : 'Read Your AI Report'}
                        </h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh
                                ? '每次打卡後，AI 教練會給你具體的下一期建議。'
                                : 'Your AI coach gives specific recommendations after each check-in.'}
                        </p>
                    </div>
                )}

                {currentStep === 'pwa' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-5xl">📱</div>
                            <h2 className="text-xl font-bold text-[#1A1814]">
                                {zh ? '加到主畫面' : 'Add to Home Screen'}
                            </h2>
                            <p className="text-sm text-black/50">
                                {zh
                                    ? '把 GymPro 加到主畫面，像 App 一樣一鍵開啟。'
                                    : 'Add GymPro to your home screen for quick access.'}
                            </p>
                        </div>
                        <div className="space-y-2">
                            {[
                                { icon: '⬆️', zh: '點 Safari 底部的分享按鈕（方框加箭頭）', en: 'Tap the Share button in Safari (box with arrow)' },
                                { icon: '➕', zh: '選「加入主畫面」', en: 'Select "Add to Home Screen"' },
                                { icon: '✅', zh: '點右上角「新增」完成', en: 'Tap "Add" to finish' },
                            ].map((item, i) => (
                                <div key={i} className="flex items-center gap-3 rounded-xl bg-black/5 p-3">
                                    <span className="text-xl shrink-0">{item.icon}</span>
                                    <p className="text-xs text-black/60">{zh ? item.zh : item.en}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step counter */}
                <p className="text-center text-xs text-black/30">
                    {step + 1} / {STEPS.length}
                </p>

                {/* Buttons */}
                <div className="flex gap-2">
                    {!isFirst && (
                        <button type="button" onClick={() => setStep((s) => s - 1)}
                            className="flex-1 rounded-md border border-black/15 px-4 py-2 text-sm text-black/50">
                            {zh ? '上一步' : 'Back'}
                        </button>
                    )}
                    <button type="button"
                        onClick={isLast ? handleFinish : () => setStep((s) => s + 1)}
                        className="flex-1 rounded-md bg-[#26241F] px-4 py-2 text-sm font-medium text-white">
                        {isLast
                            ? (zh ? '開始使用' : "Let's go")
                            : (zh ? '下一步' : 'Next')}
                    </button>
                </div>

                {canSkip && !isLast && (
                    <button type="button" onClick={handleFinish}
                        className="block w-full text-center text-xs text-black/30 hover:text-black/60">
                        {zh ? '跳過' : 'Skip'}
                    </button>
                )}
            </div>
        </div>
    )
}