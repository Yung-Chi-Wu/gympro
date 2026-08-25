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
    const [replaceExisting, setReplaceExisting] = useState(false)

    function handleOpen() {
        if (hasRoutines) {
            setShowWarning(true)
        } else {
            setShowModal(true)
        }
    }

    function handleWarningConfirm(replace: boolean) {
        setReplaceExisting(replace)
        setShowWarning(false)
        setShowModal(true)
    }

    function handleSaved() {
        setShowModal(false)
        window.location.reload()
    }

    if (!hasRoutines) {
        return (
            <>
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

                {showModal && (
                    <CoachGModal
                        language={language}
                        trainingGoal={trainingGoal}
                        replaceExisting={replaceExisting}
                        onClose={() => setShowModal(false)}
                        onSaved={handleSaved}
                    />
                )}
            </>
        )
    }

    return (
        <>
            <button type="button" onClick={handleOpen}
                className="inline-flex items-center gap-2 rounded-lg border border-ink/20 dark:border-white/20 px-3 py-1.5 text-sm text-ink/60 dark:text-white/60 hover:border-[#C8955A] hover:text-[#C8955A] transition-colors">
                ✨ {zh ? 'Coach G 設計新課表' : 'Design with Coach G'}
            </button>

            {/* 既有課表警告 */}
            {showWarning && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#2C2923] p-6 space-y-4 shadow-xl">
                        <h3 className="font-bold text-lg">
                            {zh ? '你已經有課表了' : 'You have existing routines'}
                        </h3>
                        <p className="text-sm text-ink/60">
                            {zh
                                ? `你目前有 ${routineCount} 份課表。你想要怎麼處理？`
                                : `You currently have ${routineCount} routine(s). How would you like to proceed?`}
                        </p>
                        <div className="space-y-2">
                            <button type="button"
                                onClick={() => handleWarningConfirm(false)}
                                className="w-full rounded-xl border-2 border-ink/20 dark:border-white/20 px-4 py-3 text-left space-y-0.5 hover:border-[#C8955A] transition-colors">
                                <p className="font-medium text-sm">
                                    {zh ? '➕ 新增到現有課表' : '➕ Add alongside existing'}
                                </p>
                                <p className="text-xs text-ink/40">
                                    {zh ? '保留現有課表，新增 AI 設計的課表' : 'Keep existing routines, add new AI-designed ones'}
                                </p>
                            </button>
                            <button type="button"
                                onClick={() => handleWarningConfirm(true)}
                                className="w-full rounded-xl border-2 border-red-200 dark:border-red-900 px-4 py-3 text-left space-y-0.5 hover:border-red-400 transition-colors">
                                <p className="font-medium text-sm text-red-600 dark:text-red-400">
                                    {zh ? '🗑 全部取代' : '🗑 Replace all'}
                                </p>
                                <p className="text-xs text-ink/40">
                                    {zh ? '刪除現有課表和循環，重新開始' : 'Delete all existing routines and cycle, start fresh'}
                                </p>
                            </button>
                        </div>
                        <button type="button" onClick={() => setShowWarning(false)}
                            className="w-full text-center text-sm text-ink/40 hover:text-ink transition-colors">
                            {zh ? '取消' : 'Cancel'}
                        </button>
                    </div>
                </div>
            )}

            {showModal && (
                <CoachGModal
                    language={language}
                    trainingGoal={trainingGoal}
                    replaceExisting={replaceExisting}
                    onClose={() => setShowModal(false)}
                    onSaved={handleSaved}
                />
            )}
        </>
    )
}