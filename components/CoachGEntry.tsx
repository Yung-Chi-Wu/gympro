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
                <div className="space-y-2">
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                        {zh
                            ? '⚠️ 這會刪除你現有的所有課表和訓練循環'
                            : '⚠️ This will delete all your existing routines and training cycle'}
                    </p>
                    <div className="flex gap-2">
                        <button type="button"
                            onClick={() => setShowWarning(false)}
                            className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-4 py-2.5 text-sm font-medium">
                            {zh ? '取消' : 'Cancel'}
                        </button>
                        <button type="button"
                            onClick={() => { setShowWarning(false); setShowModal(true) }}
                            className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors">
                            {zh ? '確認，重新設計' : 'Confirm, redesign'}
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