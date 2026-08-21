'use client'

import { useState, useMemo, useEffect } from 'react'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { MUSCLE_GROUPS, type ExerciseOption } from './log-types'

interface MuscleGroupExercisePickerProps {
    exercises: ExerciseOption[]
    value: string
    onChange: (exerciseId: string) => void
    language?: string
}

export function MuscleGroupExercisePicker({
    exercises,
    value,
    onChange,
    language = 'en',
}: MuscleGroupExercisePickerProps) {
    const [muscleGroup, setMuscleGroup] = useState<string>(() => {
        const current = exercises.find((ex) => ex.id === value)
        return current?.muscle_group ?? MUSCLE_GROUPS[0]
    })

    useEffect(() => {
        const match = exercises.find((ex) => ex.id === value)
        if (match) setMuscleGroup(match.muscle_group)
    }, [value, exercises])

    const exercisesInGroup = useMemo(
        () => exercises.filter((ex) => ex.muscle_group === muscleGroup),
        [exercises, muscleGroup]
    )

    function handleMuscleGroupChange(newGroup: string) {
        setMuscleGroup(newGroup)
        const firstInGroup = exercises.find((ex) => ex.muscle_group === newGroup)
        onChange(firstInGroup?.id ?? '')
    }

    const noExercisesLabel = language === 'zh-TW' ? '這個肌群還沒有動作' : 'No exercises in this group'

    return (
        <div className="flex gap-2">
            <select
                value={muscleGroup}
                onChange={(e) => handleMuscleGroupChange(e.target.value)}
                className="w-24 shrink-0 rounded-md border px-3 py-2 text-sm"
            >
                {MUSCLE_GROUPS.map((mg) => (
                    <option key={mg} value={mg}>
                        {getMuscleGroupLabel(mg, language)}
                    </option>
                ))}
            </select>

            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
            >
                {exercisesInGroup.length === 0 && (
                    <option value="">{noExercisesLabel}</option>
                )}
                {exercisesInGroup.map((ex) => {
                    const displayName =
                        language === 'zh-TW' && ex.name_zh_tw
                            ? ex.name_zh_tw
                            : ex.name
                    return (
                        <option key={ex.id} value={ex.id}>
                            {displayName}
                        </option>
                    )
                })}
            </select>
        </div>
    )
}