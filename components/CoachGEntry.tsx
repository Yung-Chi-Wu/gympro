'use client'

import { useState } from 'react'
import { CoachGModal } from './CoachGModal'
import { useRouter } from 'next/navigation'

interface CoachGEntryProps {
    hasRoutines: boolean
    language: string
    trainingGoal: string | null
}

export function CoachGEntry({ hasRoutines, language, trainingGoal }: CoachGEntryProps) {
    const zh = language === 'zh-TW'
    const [showModal, setShowModal] = useState(false)
    const router = useRouter()

    function handleSaved() {
        setShowModal(false)
        router.refresh()
    }

    if (!hasRoutines) {
        // 空狀態——大入口
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
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <button
                            type="button"
                            onClick={() => setShowModal(true)}
                            className="rounded-xl bg-plate dark:bg-white px-6 py-3 font-semibold text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity"
                        >
                            ✨ {zh ? '讓 AI 幫我設計' : 'Design with AI'}
                        </button>
                    </div>
                </div>

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

    // 有課表——小按鈕
    return (
        <>
            <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-ink/20 dark:border-white/20 px-3 py-1.5 text-sm text-ink/60 dark:text-white/60 hover:border-[#C8955A] hover:text-[#C8955A] transition-colors"
            >
                ✨ {zh ? 'Coach G 設計新課表' : 'Design with Coach G'}
            </button>

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