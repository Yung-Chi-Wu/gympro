'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMuscleGroupLabel } from '@/lib/exercise-display'

interface GeneratedExercise {
    exercise_name: string
    exercise_name_zh_tw?: string
    muscle_group: string
    target_sets: number
    target_reps: number
}

interface GeneratedRoutine {
    name: string
    name_zh_tw?: string
    exercises: GeneratedExercise[]
}

interface CoachGResultProps {
    routines: GeneratedRoutine[]
    language: string
    onBack: () => void
    onSaved: () => void
}

export function CoachGResult({ routines, language, onBack, onSaved }: CoachGResultProps) {
    const zh = language === 'zh-TW'
    const router = useRouter()
    const [editableRoutines, setEditableRoutines] = useState<GeneratedRoutine[]>(routines)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    function updateExercise(
        routineIdx: number,
        exerciseIdx: number,
        field: keyof GeneratedExercise,
        value: string | number
    ) {
        setEditableRoutines((prev) => {
            const next = prev.map((r, ri) =>
                ri !== routineIdx ? r : {
                    ...r,
                    exercises: r.exercises.map((ex, ei) =>
                        ei !== exerciseIdx ? ex : { ...ex, [field]: value }
                    ),
                }
            )
            return next
        })
    }

    function removeExercise(routineIdx: number, exerciseIdx: number) {
        setEditableRoutines((prev) =>
            prev.map((r, ri) =>
                ri !== routineIdx ? r : {
                    ...r,
                    exercises: r.exercises.filter((_, ei) => ei !== exerciseIdx),
                }
            )
        )
    }

    function updateRoutineName(routineIdx: number, name: string) {
        setEditableRoutines((prev) =>
            prev.map((r, ri) => ri !== routineIdx ? r : { ...r, name })
        )
    }

    async function handleSave() {
        setIsSaving(true)
        setError(null)

        try {
            const res = await fetch('/api/ai/save-routine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routines: editableRoutines }),
            })

            const data = await res.json()

            if (!data.success) {
                throw new Error(data.error ?? 'Save failed')
            }

            router.refresh()
            onSaved()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-ink/10">
                <div>
                    <p className="font-semibold">
                        {zh ? '✨ Coach G 的課表建議' : '✨ Coach G\'s Routine'}
                    </p>
                    <p className="text-xs text-ink/40">
                        {zh ? '可以直接修改，滿意後再存入' : 'Edit freely, then save when ready'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onBack}
                    className="text-sm text-ink/40 hover:text-ink"
                >
                    {zh ? '重新設計' : 'Redesign'}
                </button>
            </div>

            {/* Routines */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {error && (
                    <p className="text-sm text-red-600">{error}</p>
                )}

                {editableRoutines.map((routine, ri) => (
                    <div key={ri} className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3 shadow-sm">
                        {/* Routine name */}
                        <input
                            type="text"
                            value={zh && routine.name_zh_tw ? routine.name_zh_tw : routine.name}
                            onChange={(e) => updateRoutineName(ri, e.target.value)}
                            className="w-full text-base font-semibold bg-transparent border-b border-ink/10 pb-1 focus:outline-none focus:border-plate"
                        />

                        {/* Exercises */}
                        <div className="space-y-2">
                            {routine.exercises.map((ex, ei) => (
                                <div key={ei} className="flex items-center gap-2 text-sm">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-ink/40">
                                            {getMuscleGroupLabel(ex.muscle_group, language)}
                                        </p>
                                        <p className="font-medium truncate">
                                            {zh && ex.exercise_name_zh_tw
                                                ? ex.exercise_name_zh_tw
                                                : ex.exercise_name}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={ex.target_sets}
                                            onChange={(e) => updateExercise(ri, ei, 'target_sets', Number(e.target.value))}
                                            className="w-10 text-center rounded border border-ink/10 py-0.5 text-xs"
                                        />
                                        <span className="text-ink/40 text-xs">×</span>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={ex.target_reps}
                                            onChange={(e) => updateExercise(ri, ei, 'target_reps', Number(e.target.value))}
                                            className="w-10 text-center rounded border border-ink/10 py-0.5 text-xs"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeExercise(ri, ei)}
                                        className="text-ink/30 hover:text-red-500 transition-colors ml-1"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Save button */}
            <div className="p-4 border-t border-ink/10">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full rounded-xl bg-plate dark:bg-white py-3 text-sm font-semibold text-chalk dark:text-[#1A1814] disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                    {isSaving
                        ? (zh ? '存入中...' : 'Saving...')
                        : (zh ? '✓ 存入我的課表' : '✓ Save to My Routines')}
                </button>
            </div>
        </div>
    )
}