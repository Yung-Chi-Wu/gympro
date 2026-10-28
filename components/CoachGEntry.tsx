'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BUTTON } from '@/lib/ui'
import { CoachGModal } from './CoachGModal'

interface CoachGEntryProps {
    hasRoutines: boolean
    routineCount: number
    language: string
    /**
     * With routines: 'button' sits in the page header, 'card' below the phone's list.
     * Without routines both are the big invitation, so the page shows only one of them.
     * 'auto' has no entry of its own: Coach G opens at once (from 今天's link), after the
     * warning when there are routines.
     */
    variant?: 'button' | 'card' | 'auto'
}

export function CoachGEntry({ hasRoutines, routineCount, language, variant = 'button' }: CoachGEntryProps) {
    const zh = language === 'zh-TW'
    const t = useTranslations('routines')
    const [showModal, setShowModal] = useState(variant === 'auto' && !hasRoutines)
    const [showWarning, setShowWarning] = useState(variant === 'auto' && hasRoutines)

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
            {variant === 'auto' ? null : !hasRoutines ? (
                <div className="rounded-card border-2 border-dashed border-line p-8 text-center space-y-4">
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
                    <button type="button" onClick={handleOpen} className={BUTTON.primary}>
                        ✨ {zh ? '讓 AI 幫我設計' : 'Design with AI'}
                    </button>
                </div>
            ) : variant === 'button' ? (
                <button type="button" onClick={handleOpen} className={`${BUTTON.secondary} shrink-0`}>
                    {t('coachGButton')}
                </button>
            ) : (
                <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-card p-4 text-center md:gap-2">
                    <span className="text-[15px] text-muted md:text-[13px]">{t('coachGPrompt')}</span>
                    <button type="button" onClick={handleOpen} className={BUTTON.secondary}>
                        {t('coachGButton')}
                    </button>
                </div>
            )}

            {/* 警告 modal */}
            {showWarning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                    <div className="w-full max-w-sm space-y-5 rounded-sheet bg-raised p-6 shadow-float">
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
                            <p className="text-sm font-medium text-miss">
                                {zh ? '此操作無法復原' : 'This action cannot be undone'}
                            </p>
                        </div>

                        {/* On a phone the two are stacked full width, the confirm on top; side by side from md */}
                        <div className="flex flex-col-reverse gap-2 md:flex-row">
                            <button type="button"
                                onClick={() => setShowWarning(false)}
                                className={`${BUTTON.secondary} md:flex-1`}>
                                {zh ? '取消' : 'Cancel'}
                            </button>
                            <button type="button"
                                onClick={() => { setShowWarning(false); setShowModal(true) }}
                                className={`${BUTTON.dangerConfirm} md:flex-1`}>
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
                    onClose={() => setShowModal(false)}
                    onSaved={handleSaved}
                />
            )}
        </>
    )
}