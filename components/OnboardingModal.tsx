'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { WeightUnit } from '@/lib/weight-unit'

interface Step {
    icon: string
    titleEn: string
    titleZh: string
    descEn: string
    descZh: string
    isUnitStep?: boolean
}

const STEPS: Step[] = [
    {
        icon: '⚖️',
        titleEn: 'Choose Your Weight Unit',
        titleZh: '選擇你的重量單位',
        descEn: 'You can change this anytime in Settings.',
        descZh: '之後可以在設定裡隨時更改。',
        isUnitStep: true,
    },
    {
        icon: '📋',
        titleEn: 'Build Your Routines',
        titleZh: '建立你的課表',
        descEn: 'Go to Routines to add exercises and set up your training cycle — how many days repeat before it resets.',
        descZh: '前往「訓練課表」新增動作，設定你的訓練循環——幾天一輪、每天練什麼。',
    },
    {
        icon: '💪',
        titleEn: 'Log Every Day',
        titleZh: '每天記錄訓練',
        descEn: 'Open the Today card on your Dashboard and log each set as you train — weight and reps for every exercise.',
        descZh: '每次訓練時打開主頁的「今天」卡片，把每一組的重量和次數記下來。',
    },
    {
        icon: '⚖️',
        titleEn: 'Check In at Period End',
        titleZh: '週期結束時打卡',
        descEn: 'When your training period ends, confirm your weight and check in. This triggers your AI analysis.',
        descZh: '訓練週期快結束時，確認體重並打卡。這會觸發 AI 分析你這期的訓練。',
    },
    {
        icon: '🤖',
        titleEn: 'Read Your AI Report',
        titleZh: '閱讀 AI 教練報告',
        descEn: 'After check-in, your AI coach analyses your training data and gives you specific recommendations for next period.',
        descZh: '打卡後，AI 教練會分析你的訓練數據，給你下一期的具體建議。',
    },
]

interface OnboardingModalProps {
    userId: string
    language: string
    onClose?: () => void
}

export function OnboardingModal({ userId, language, onClose }: OnboardingModalProps) {
    const zh = language === 'zh-TW'
    const supabase = createClient()
    const [step, setStep] = useState(0)
    const [visible, setVisible] = useState(true)
    const [selectedUnit, setSelectedUnit] = useState<WeightUnit>('kg')

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
            } as never)
            .eq('user_id', userId)
        setVisible(false)
    }

    if (!visible) return null

    const current = STEPS[step]
    const isLast = step === STEPS.length - 1

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-5">
                <div className="flex justify-center gap-2">
                    {STEPS.map((_, i) => (
                        <div
                            key={i}
                            className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-plate' : 'w-1.5 bg-ink/20'
                                }`}
                        />
                    ))}
                </div>

                <div className="text-center space-y-3">
                    <div className="text-5xl">{current.icon}</div>
                    <h2 className="text-xl font-bold">
                        {zh ? current.titleZh : current.titleEn}
                    </h2>
                    <p className="text-sm text-ink/60 leading-relaxed">
                        {zh ? current.descZh : current.descEn}
                    </p>
                </div>

                {current.isUnitStep && (
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => setSelectedUnit('kg')}
                            className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedUnit === 'kg'
                                    ? 'border-plate bg-plate text-chalk'
                                    : 'border-ink/20 text-ink/60'
                                }`}
                        >
                            kg
                            <span className="block text-xs font-normal mt-0.5">
                                {zh ? '公斤' : 'Kilogram'}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedUnit('lb')}
                            className={`flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selectedUnit === 'lb'
                                    ? 'border-plate bg-plate text-chalk'
                                    : 'border-ink/20 text-ink/60'
                                }`}
                        >
                            lb
                            <span className="block text-xs font-normal mt-0.5">
                                {zh ? '磅' : 'Pound'}
                            </span>
                        </button>
                    </div>
                )}

                <p className="text-center text-xs text-ink/30">
                    {step + 1} / {STEPS.length}
                </p>

                <div className="flex gap-2">
                    {step > 0 && (
                        <button
                            type="button"
                            onClick={() => setStep((s) => s - 1)}
                            className="flex-1 rounded-md border px-4 py-2 text-sm text-ink/60"
                        >
                            {zh ? '上一步' : 'Back'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={isLast ? handleFinish : () => setStep((s) => s + 1)}
                        className="flex-1 rounded-md bg-plate px-4 py-2 text-sm font-medium text-chalk"
                    >
                        {isLast
                            ? (zh ? '開始使用' : "Let's go")
                            : (zh ? '下一步' : 'Next')}
                    </button>
                </div>

                {!isLast && (
                    <button
                        type="button"
                        onClick={handleFinish}
                        className="block w-full text-center text-xs text-ink/30 hover:text-ink/60"
                    >
                        {zh ? '跳過' : 'Skip'}
                    </button>
                )}
            </div>
        </div>
    )
}