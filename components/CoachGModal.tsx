'use client'

import { useId, useState } from 'react'
import { CoachGChat } from './CoachGChat'
import { CoachGResult } from './CoachGResult'
import { Sheet } from './Sheet'

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
    const titleId = useId()

    return (
        // Only its own buttons close it: a tap outside or Escape would lose the answers so far, or the plan
        <Sheet labelledBy={titleId} tall dismissable={false}>
            <h2 id={titleId} className="sr-only">Coach G</h2>
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
        </Sheet>
    )
}