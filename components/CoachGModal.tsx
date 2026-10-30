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
    goals: string[]
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
            {/* The app's dialog surface, as Coach G's entry dialog: bg-raised has its own night color, so
                the buttons' tonal fill (bg-done) stands out on it in both themes */}
            <div className="flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-sheet bg-raised shadow-float">
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
                        goals={generatedPlan.goals}
                    />
                ) : (
                    <CoachGChat
                        language={language}
                        onRoutinesGenerated={(routines, cycleLength, goals) =>
                            setGeneratedPlan({ routines, cycleLength, goals })
                        }
                        onClose={onClose}
                    />
                )}
            </div>
        </div>
    )
}