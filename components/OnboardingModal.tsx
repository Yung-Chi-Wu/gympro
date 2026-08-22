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
    isPwaStep?: boolean
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
        descEn: 'Go to Routines to add exercises and set up your training cycle.',
        descZh: '前往「訓練課表」新增動作，設定你的訓練循環。',
    },
    {
        icon: '💪',
        titleEn: 'Log Every Day',
        titleZh: '每天記錄訓練',
        descEn: 'Open the Today card and log each set — weight and reps for every exercise.',
        descZh: '打開主頁的「今天」卡片，把每一組的重量和次數記下來。',
    },
    {
        icon: '⚖️',
        titleEn: 'Check In at Period End',
        titleZh: '週期結束時打卡',
        descEn: 'Confirm your weight and check in — this triggers your AI analysis.',
        descZh: '確認體重並打卡，這會觸發 AI 分析你這期的訓練。',
    },
    {
        icon: '🤖',
        titleEn: 'Read Your AI Report',
        titleZh: '閱讀 AI 教練報告',
        descEn: 'Your AI coach gives specific recommendations after each check-in.',
        descZh: '每次打卡後，AI 教練會給你具體的下一期建議。',
    },
    {
        icon: '📱',
        titleEn: 'Use Like an App',
        titleZh: '像 App 一樣使用',
        descEn: '',
        descZh: '',
        isPwaStep: true,
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
        localStorage.setItem('onboarding_completed', 'true')
        setVisible(false)
    }

    if (!visible) return null

    const current = STEPS[step]
    const isLast = step === STEPS.length - 1

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 px-4 pb-6 sm:items-center sm:pb-0">
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
                    {!current.isPwaStep && (
                        <p className="text-sm text-ink/60 leading-relaxed">
                            {zh ? current.descZh : current.descEn}
                        </p>
                    )}
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

                {current.isPwaStep && (
                    <div className="space-y-4">
                        <p className="text-center text-sm text-ink/60">
                            {zh
                                ? '把 GymPro 加到主畫面，下次直接點圖示開啟，像原生 App 一樣。'
                                : 'Add GymPro to your home screen for quick one-tap access, just like a native app.'}
                        </p>

                        {/* 視覺化步驟 */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 rounded-xl bg-ink/5 p-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm text-xl">
                                    ⬆️
                                </div>
                                <div className="text-sm">
                                    <p className="font-medium">
                                        {zh ? '① 點分享按鈕' : '① Tap Share'}
                                    </p>
                                    <p className="text-xs text-ink/50">
                                        {zh ? 'Safari 底部工具列中間的方框加箭頭' : 'Box with arrow at the bottom of Safari'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 rounded-xl bg-ink/5 p-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm text-xl">
                                    ➕
                                </div>
                                <div className="text-sm">
                                    <p className="font-medium">
                                        {zh ? '② 選「加入主畫面」' : '② "Add to Home Screen"'}
                                    </p>
                                    <p className="text-xs text-ink/50">
                                        {zh ? '在選單裡往下滑找到這個選項' : 'Scroll down in the share menu'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 rounded-xl bg-ink/5 p-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm text-xl">
                                    ✅
                                </div>
                                <div className="text-sm">
                                    <p className="font-medium">
                                        {zh ? '③ 點右上角「新增」' : '③ Tap "Add"'}
                                    </p>
                                    <p className="text-xs text-ink/50">
                                        {zh ? '完成！GymPro 就在你的主畫面了' : 'Done! GymPro appears on your home screen'}
                                    </p>
                                </div>
                            </div>
                        </div>
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