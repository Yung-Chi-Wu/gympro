'use client'

import { useState } from 'react'
import { CoachGModal } from './CoachGModal'

interface CoachGEntryProps {
    hasRoutines: boolean
    routineCount: number
    language: string
    trainingGoal: string | null
}

export function CoachGEntry({ hasRoutines, routineCount, language, trainingGoal }: CoachGEntryProps) {
    const zh = language === 'zh-TW'
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
                <div className="rounded-2xl border-2 border-dashed border-ink/20 p-8 text-center space-y-4">
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
                        className="rounded-xl bg-plate dark:bg-white px-6 py-3 font-semibold text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity">
                        ✨ {zh ? '讓 AI 幫我設計' : 'Design with AI'}
                    </button>
                </div>
            ) : (
                <button type="button" onClick={handleOpen}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#C8955A]/40 bg-[#C8955A]/8 px-3 py-1.5 text-sm font-medium text-[#C8955A] hover:bg-[#C8955A]/15 transition-colors shrink-0">
                    ✨ {zh ? 'Coach G →' : 'Coach G →'}
                </button>
            )}

            {/* 警告 modal */}
            {showWarning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#2C2923] p-6 shadow-xl space-y-5">
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