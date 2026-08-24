'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WeightUnit } from '@/lib/weight-unit'

interface OnboardingModalProps {
    userId: string
    language: string
    onClose?: () => void
}

export function OnboardingModal({ userId, language, onClose }: OnboardingModalProps) {
    const supabase = createClient()
    const [step, setStep] = useState(0)
    const [visible, setVisible] = useState(true)
    const [selectedUnit, setSelectedUnit] = useState<WeightUnit>('kg')
    const [selectedLang, setSelectedLang] = useState(language)

    const zh = selectedLang === 'zh-TW'

    const STEPS = [
        { key: 'lang' },
        { key: 'unit' },
        { key: 'routines' },
        { key: 'log' },
        { key: 'checkin' },
        { key: 'report' },
        { key: 'pwa' },
    ]

    async function handleFinish() {
        if (onClose) {
            onClose()
            setVisible(false)
            return
        }
        await supabase
            .from('user_profiles')
            .update({
                onboarding_completed: true,
                weight_unit: selectedUnit,
                language: selectedLang,
            } as never)
            .eq('user_id', userId)

        // 更新 cookie 讓語言立即生效
        document.cookie = `language=${selectedLang}; path=/; max-age=${60 * 60 * 24 * 365}`
        localStorage.setItem('onboarding_completed', 'true')

        // 重新載入讓語言設定生效
        window.location.href = '/dashboard'
    }

    if (!visible) return null

    const currentStep = STEPS[step]
    const isLast = step === STEPS.length - 1
    const isFirst = step === 0

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-0">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-5">

                {/* Progress dots */}
                <div className="flex justify-center gap-2">
                    {STEPS.map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-[#26241F]' : 'w-1.5 bg-black/10'
                            }`} />
                    ))}
                </div>

                {/* Step content */}
                {currentStep.key === 'lang' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">🌐</div>
                            <h2 className="text-xl font-bold">Language / 語言</h2>
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setSelectedLang('en')}
                                className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedLang === 'en' ? 'border-[#26241F] bg-[#26241F] text-white' : 'border-black/10 text-black/50'
                                    }`}>
                                English
                            </button>
                            <button type="button" onClick={() => setSelectedLang('zh-TW')}
                                className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedLang === 'zh-TW' ? 'border-[#26241F] bg-[#26241F] text-white' : 'border-black/10 text-black/50'
                                    }`}>
                                繁體中文
                            </button>
                        </div>
                        <p className="text-center text-xs text-black/40">
                            {zh ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                        </p>
                    </div>
                )}

                {currentStep.key === 'unit' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">⚖️</div>
                            <h2 className="text-xl font-bold">{zh ? '選擇重量單位' : 'Choose Weight Unit'}</h2>
                            <p className="text-sm text-black/50">{zh ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}</p>
                        </div>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => setSelectedUnit('kg')}
                                className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedUnit === 'kg' ? 'border-[#26241F] bg-[#26241F] text-white' : 'border-black/10 text-black/50'
                                    }`}>
                                kg<span className="block text-xs font-normal mt-0.5">{zh ? '公斤' : 'Kilogram'}</span>
                            </button>
                            <button type="button" onClick={() => setSelectedUnit('lb')}
                                className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedUnit === 'lb' ? 'border-[#26241F] bg-[#26241F] text-white' : 'border-black/10 text-black/50'
                                    }`}>
                                lb<span className="block text-xs font-normal mt-0.5">{zh ? '磅' : 'Pound'}</span>
                            </button>
                        </div>
                    </div>
                )}

                {currentStep.key === 'routines' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">📋</div>
                        <h2 className="text-xl font-bold">{zh ? '建立你的課表' : 'Build Your Routines'}</h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh ? '前往「訓練課表」新增動作，設定訓練循環——幾天一輪、每天練什麼。' : 'Go to Routines to add exercises and set up your training cycle.'}
                        </p>
                    </div>
                )}

                {currentStep.key === 'log' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">💪</div>
                        <h2 className="text-xl font-bold">{zh ? '每天記錄訓練' : 'Log Every Day'}</h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh ? '打開主頁的「今天」卡片，把每一組的重量和次數記下來。' : 'Open the Today card and log each set — weight and reps for every exercise.'}
                        </p>
                    </div>
                )}

                {currentStep.key === 'checkin' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">⚖️</div>
                        <h2 className="text-xl font-bold">{zh ? '週期結束時打卡' : 'Check In at Period End'}</h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh ? '確認體重並打卡，這會觸發 AI 分析你這期的訓練。' : 'Confirm your weight and check in — this triggers your AI analysis.'}
                        </p>
                    </div>
                )}

                {currentStep.key === 'report' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">🤖</div>
                        <h2 className="text-xl font-bold">{zh ? '閱讀 AI 教練報告' : 'Read Your AI Report'}</h2>
                        <p className="text-sm text-black/50 leading-relaxed">
                            {zh ? '每次打卡後，AI 教練會給你具體的下一期建議。' : 'Your AI coach gives specific recommendations after each check-in.'}
                        </p>
                    </div>
                )}

                {currentStep.key === 'pwa' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-5xl">📱</div>
                            <h2 className="text-xl font-bold">{zh ? '加到主畫面' : 'Add to Home Screen'}</h2>
                            <p className="text-sm text-black/50">
                                {zh ? '把 GymPro 加到主畫面，像 App 一樣一鍵開啟。' : 'Add GymPro to your home screen for quick access.'}
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
                <p className="text-center text-xs text-black/30">{step + 1} / {STEPS.length}</p>

                {/* Buttons */}
                <div className="flex gap-2">
                    {!isFirst && (
                        <button type="button" onClick={() => setStep((s) => s - 1)}
                            className="flex-1 rounded-md border px-4 py-2 text-sm text-black/50">
                            {zh ? '上一步' : 'Back'}
                        </button>
                    )}
                    <button type="button"
                        onClick={isLast ? handleFinish : () => setStep((s) => s + 1)}
                        className="flex-1 rounded-md bg-[#26241F] px-4 py-2 text-sm font-medium text-white">
                        {isLast ? (zh ? '開始使用' : "Let's go") : (zh ? '下一步' : 'Next')}
                    </button>
                </div>

                {/* 前兩步（語言、單位）不能跳過，後面的可以 */}
                {step >= 2 && !isLast && (
                    <button type="button" onClick={handleFinish}
                        className="block w-full text-center text-xs text-black/30 hover:text-black/60">
                        {zh ? '跳過' : 'Skip'}
                    </button>
                )}
            </div>
        </div>
    )
}