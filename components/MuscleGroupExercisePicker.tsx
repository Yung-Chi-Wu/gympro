'use client'

import { useState, useMemo } from 'react'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { MUSCLE_GROUPS, type ExerciseOption } from './log-types'

interface MuscleGroupExercisePickerProps {
    exercises: ExerciseOption[]
    value: string
    onChange: (exerciseId: string) => void
    language?: string
    /** The group shown before an exercise is picked */
    initialGroup?: string
    /** Shown while no exercise is picked; changing the group then leaves the choice to the user */
    placeholder?: string
}

export function MuscleGroupExercisePicker({
    exercises,
    value,
    onChange,
    language = 'en',
    initialGroup,
    placeholder,
}: MuscleGroupExercisePickerProps) {
    // The group picked by hand; it shows only while no exercise is selected (an empty group)
    const [pickedGroup, setPickedGroup] = useState<string>(initialGroup ?? MUSCLE_GROUPS[0])
    // Otherwise the selected exercise's group, so a value set from outside moves the group with it
    const muscleGroup = exercises.find((ex) => ex.id === value)?.muscle_group ?? pickedGroup

    const exercisesInGroup = useMemo(
        () => exercises.filter((ex) => ex.muscle_group === muscleGroup),
        [exercises, muscleGroup]
    )

    function handleMuscleGroupChange(newGroup: string) {
        setPickedGroup(newGroup)
        if (placeholder) return
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
                {exercisesInGroup.length === 0 ? (
                    <option value="">{noExercisesLabel}</option>
                ) : placeholder && !value && (
                    <option value="">{placeholder}</option>
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