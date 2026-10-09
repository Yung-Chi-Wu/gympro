'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CoachGModal } from './CoachGModal'

interface CoachGEntryProps {
    hasRoutines: boolean
    routineCount: number
    language: string
    trainingGoal: string | null
    /**
     * With routines: 'button' sits in the page header, 'card' below the phone's list.
     * Without routines both are the big invitation, so the page shows only one of them.
     */
    variant?: 'button' | 'card'
}

export function CoachGEntry({ hasRoutines, routineCount, language, trainingGoal, variant = 'button' }: CoachGEntryProps) {
    const zh = language === 'zh-TW'
    const t = useTranslations('routines')
    const [showModal, setShowModal] = useState(false)
    const [showWarning, setShowWarning] = useState(false)

    function handleOpen() {
        if (hasRoutines) {
            setShowWarning(true)
        } else {
            setShowModal(true)
        }
    }

    function handleSaved() {
        setShowModal(false)
        window.location.reload()
    }

    return (
        <>
            {/* 入口按鈕 */}
            {!hasRoutines ? (
                <div className="rounded-[14px] border-2 border-dashed border-line p-8 text-center space-y-4">
                    <div className="text-4xl">🤖</div>
                    <div>
                        <p className="font-semibold text-lg">
                            {zh ? '讓 Coach G 幫你設計課表' : 'Let Coach G design your routine'}
                        </p>
                        <p className="text-sm text-ink/50 mt-1">
                            {zh
                                ? '告訴 AI 你的目標和條件，他會幫你生成一份完整的訓練計畫'
                                : 'Tell AI your goals and Coach G will build a complete training plan for you'}
                        </p>
                    </div>
                    <button type="button" onClick={handleOpen}
                        className="rounded-[9px] bg-accent px-6 py-3 font-bold text-accent-ink hover:opacity-90 transition-opacity">
                        ✨ {zh ? '讓 AI 幫我設計' : 'Design with AI'}
                    </button>
                </div>
            ) : variant === 'button' ? (
                <button type="button" onClick={handleOpen}
                    className="inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-[9px] border border-line bg-card px-3 text-[13px] font-bold transition-colors hover:bg-done">
                    {t('coachGButton')}
                </button>
            ) : (
                <div className="flex flex-col items-center gap-3 rounded-[14px] border border-line bg-card p-4 text-center md:gap-2">
                    <span className="text-[15px] text-muted md:text-[13px]">{t('coachGPrompt')}</span>
                    <button type="button" onClick={handleOpen}
                        className="inline-flex min-h-11 items-center rounded-[9px] border border-line bg-card px-4 text-[15px] font-bold transition-colors hover:bg-done md:min-h-9 md:px-3 md:text-[13px]">
                        {t('coachGButton')}
                    </button>
                </div>
            )}

            {/* 警告 modal */}
            {showWarning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                    <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#2C2923] p-6 shadow-xl space-y-5">
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-sm shrink-0">
                                G
                            </div>
                            <div>
                                <p className="font-semibold text-sm">Coach G</p>
                                <p className="text-xs text-ink/40">
                                    {zh ? 'AI 課表設計師' : 'AI Routine Designer'}
                                </p>
                            </div>
                        </div>

                        {/* 說明 */}
                        <div className="space-y-2">
                            <p className="font-medium">
                                {zh ? '重新設計課表' : 'Redesign your routine'}
                            </p>
                            <p className="text-sm text-ink/60">
                                {zh
                                    ? `你目前有 ${routineCount} 份課表。重新設計會刪除所有現有課表和訓練循環，讓 Coach G 從零幫你設計一套新的。`
                                    : `You have ${routineCount} existing routine(s). Redesigning will delete all your current routines and training cycle so Coach G can build a fresh plan from scratch.`}
                            </p>
                            <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 px-3 py-2">
                                <p className="text-xs text-red-600 dark:text-red-400">
                                    ⚠️ {zh ? '此操作無法復原' : 'This action cannot be undone'}
                                </p>
                            </div>
                        </div>

                        {/* 按鈕 */}
                        <div className="flex gap-2">
                            <button type="button"
                                onClick={() => setShowWarning(false)}
                                className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-4 py-2.5 text-sm font-medium hover:opacity-80 transition-opacity">
                                {zh ? '取消' : 'Cancel'}
                            </button>
                            <button type="button"
                                onClick={() => { setShowWarning(false); setShowModal(true) }}
                                className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2.5 text-sm font-medium text-white transition-colors">
                                {zh ? '確認，重新設計' : 'Confirm, redesign'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Coach G Modal */}
            {showModal && (
                <CoachGModal
                    language={language}
                    trainingGoal={trainingGoal}
                    onClose={() => setShowModal(false)}
                    onSaved={handleSaved}
                />
            )}
        </>
    )
}