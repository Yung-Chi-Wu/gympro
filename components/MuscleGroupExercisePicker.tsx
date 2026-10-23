'use client'

import { useState, useMemo } from 'react'
import { exerciseSections, getExerciseName, getMuscleGroupLabel } from '@/lib/exercise-display'
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
    /**
     * For a choice already saved: changing the group only shows that group's exercises, and
     * nothing changes until one is picked (picking the group's first one swapped a saved exercise)
     */
    keepUntilPicked?: boolean
}

/** A group's exercises as listed: done lately first, then by equipment (lib/exercise-display.ts) */
const sectionsOf = (exercises: ExerciseOption[], group: string, language: string) =>
    exerciseSections(exercises.filter((ex) => ex.muscle_group === group), language)

export function MuscleGroupExercisePicker({
    exercises,
    value,
    onChange,
    language = 'en',
    initialGroup,
    placeholder,
    keepUntilPicked = false,
}: MuscleGroupExercisePickerProps) {
    // The group picked by hand; it shows only while no exercise is selected (an empty group)
    const [pickedGroup, setPickedGroup] = useState<string>(initialGroup ?? MUSCLE_GROUPS[0])
    // A group being looked through for a saved choice (keepUntilPicked), until an exercise is picked
    const [browseGroup, setBrowseGroup] = useState<string | null>(null)
    // Otherwise the selected exercise's group, so a value set from outside moves the group with it
    const valueGroup = exercises.find((ex) => ex.id === value)?.muscle_group
    const muscleGroup = browseGroup ?? valueGroup ?? pickedGroup

    const sections = useMemo(() => sectionsOf(exercises, muscleGroup, language), [exercises, muscleGroup, language])
    const exercisesInGroup = sections.flatMap((section) => section.exercises)

    function handleMuscleGroupChange(newGroup: string) {
        setPickedGroup(newGroup)
        if (keepUntilPicked) {
            setBrowseGroup(newGroup === valueGroup ? null : newGroup)
            return
        }
        if (placeholder) return
        // The first one listed, so what is picked is what shows on top
        onChange(sectionsOf(exercises, newGroup, language)[0]?.exercises[0]?.id ?? '')
    }

    const noExercisesLabel = language === 'zh-TW' ? '這個肌群還沒有動作' : 'No exercises in this group'
    const valueInGroup = exercisesInGroup.some((ex) => ex.id === value)
    const chooseLabel = placeholder ?? (language === 'zh-TW' ? '選擇動作' : 'Choose an exercise')
    const showChoose = (!!placeholder && !value) || (keepUntilPicked && !valueInGroup)

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
                value={keepUntilPicked && !valueInGroup ? '' : value}
                onChange={(e) => {
                    setBrowseGroup(null)
                    onChange(e.target.value)
                }}
                className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
            >
                {exercisesInGroup.length === 0 ? (
                    <option value="">{noExercisesLabel}</option>
                ) : showChoose && (
                    <option value="" disabled={keepUntilPicked}>{chooseLabel}</option>
                )}
                {sections.map((section) => (
                    <optgroup key={section.key} label={section.label}>
                        {section.exercises.map((ex) => (
                            <option key={ex.id} value={ex.id}>
                                {getExerciseName(ex, language)}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </div>
    )
}