'use client'

import { useState } from 'react'
import { CoachGChat } from './CoachGChat'
import { CoachGResult } from './CoachGResult'

interface GeneratedRoutine {
    name: string
    name_zh_tw?: string
    day_indices: number[]
    exercises: {
        exercise_id: string
        exercise_name: string
        exercise_name_zh_tw?: string
        muscle_group: string
        target_sets: number
        target_reps: number
    }[]
}

interface GeneratedPlan {
    routines: GeneratedRoutine[]
    cycleLength: number
}

interface CoachGModalProps {
    language: string
    onClose: () => void
    onSaved: () => void
}

export function CoachGModal({ language, onClose, onSaved }: CoachGModalProps) {
    const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg h-[85vh] rounded-xl bg-white dark:bg-[#2C2923] shadow-xl flex flex-col overflow-hidden">
                {generatedPlan ? (
                    <CoachGResult
                        routines={generatedPlan.routines}
                        cycleLength={generatedPlan.cycleLength}
                        language={language}
                        // Redesign starts the questions over, and this plan is gone
                        onBack={() => {
                            if (confirm(language === 'zh-TW' ? '重新設計會清掉這份課表，從第一題重新開始。要重新設計嗎？' : 'Redesigning drops this plan and starts again from the first question. Redesign?')) setGeneratedPlan(null)
                        }}
                        onSaved={onSaved}
                    />
                ) : (
                    <CoachGChat
                        language={language}
                        onRoutinesGenerated={(routines, cycleLength) =>
                            setGeneratedPlan({ routines, cycleLength })
                        }
                        onClose={onClose}
                    />
                )}
            </div>
        </div>
    )
}