'use client'

import { useState, useMemo, useEffect } from 'react'
import { MUSCLE_GROUPS, type ExerciseOption } from './log-types'

interface MuscleGroupExercisePickerProps {
    exercises: ExerciseOption[]
    value: string
    onChange: (exerciseId: string) => void
}

export function MuscleGroupExercisePicker({
    exercises,
    value,
    onChange,
}: MuscleGroupExercisePickerProps) {
    const [muscleGroup, setMuscleGroup] = useState<string>(() => {
        const current = exercises.find((ex) => ex.id === value)
        return current?.muscle_group ?? MUSCLE_GROUPS[0]
    })

    // If the selected exercise changes from *outside* this component
    // (e.g. the parent just created a brand new custom exercise and
    // selected it), make sure the muscle-group dropdown catches up so
    // the exercise still shows up in the second list.
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

    return (
        <div className="flex gap-2">
            <select
                value={muscleGroup}
                onChange={(e) => handleMuscleGroupChange(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm capitalize"
            >
                {MUSCLE_GROUPS.map((mg) => (
                    <option key={mg} value={mg}>
                        {mg}
                    </option>
                ))}
            </select>

            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 rounded-md border px-3 py-2 text-sm"
            >
                {exercisesInGroup.length === 0 && (
                    <option value="">No exercises in this group</option>
                )}
                {exercisesInGroup.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                        {ex.name}
                    </option>
                ))}
            </select>
        </div>
    )
}