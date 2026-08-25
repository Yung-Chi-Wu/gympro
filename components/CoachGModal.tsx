'use client'

import { useState } from 'react'
import { CoachGChat } from './CoachGChat'
import { CoachGResult } from './CoachGResult'

interface GeneratedRoutine {
    name: string
    name_zh_tw?: string
    exercises: {
        exercise_name: string
        exercise_name_zh_tw?: string
        muscle_group: string
        target_sets: number
        target_reps: number
    }[]
}

interface CoachGModalProps {
    language: string
    trainingGoal: string | null
    onClose: () => void
    onSaved: () => void
}

export function CoachGModal({ language, trainingGoal, onClose, onSaved }: CoachGModalProps) {
    const [generatedRoutines, setGeneratedRoutines] = useState<GeneratedRoutine[] | null>(null)

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg h-[80vh] rounded-2xl bg-white dark:bg-[#2C2923] shadow-xl flex flex-col overflow-hidden">
                {generatedRoutines ? (
                    <CoachGResult
                        routines={generatedRoutines}
                        language={language}
                        onBack={() => setGeneratedRoutines(null)}
                        onSaved={onSaved}
                    />
                ) : (
                    <CoachGChat
                        language={language}
                        trainingGoal={trainingGoal}
                        onRoutinesGenerated={setGeneratedRoutines}
                        onClose={onClose}
                    />
                )}
            </div>
        </div>
    )
}