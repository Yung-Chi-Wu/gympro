'use client'

import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toFriendlyError } from '@/lib/friendly-error'
import { MUSCLE_GROUPS, type ExerciseOption } from './log-types'

interface MuscleGroupExercisePickerProps {
    exercises: ExerciseOption[]
    value: string
    onChange: (exerciseId: string) => void
    onExerciseCreated?: (exercise: ExerciseOption) => void
}

export function MuscleGroupExercisePicker({
    exercises,
    value,
    onChange,
    onExerciseCreated,
}: MuscleGroupExercisePickerProps) {
    const supabase = createClient()
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

    const [showNewExercise, setShowNewExercise] = useState(false)
    const [newExerciseName, setNewExerciseName] = useState('')
    const [newExerciseEquipment, setNewExerciseEquipment] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    function handleMuscleGroupChange(newGroup: string) {
        setMuscleGroup(newGroup)
        const firstInGroup = exercises.find((ex) => ex.muscle_group === newGroup)
        onChange(firstInGroup?.id ?? '')
    }

    async function handleCreateExercise() {
        setError(null)
        const trimmedName = newExerciseName.trim()
        if (!trimmedName) {
            setError('Give the exercise a name.')
            return
        }

        setIsSaving(true)
        try {
            const { data, error: insertError } = await supabase
                .from('exercises')
                .insert({
                    name: trimmedName,
                    muscle_group: muscleGroup,
                    equipment: newExerciseEquipment.trim() || null,
                    is_custom: true,
                })
                .select('id, name, muscle_group, equipment')
                .single()

            if (insertError || !data) {
                throw new Error(toFriendlyError(insertError))
            }

            onExerciseCreated?.(data)
            onChange(data.id)
            setNewExerciseName('')
            setNewExerciseEquipment('')
            setShowNewExercise(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="space-y-2">
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}

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

                {!showNewExercise && (
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
                )}

                <button
                    type="button"
                    onClick={() => setShowNewExercise((v) => !v)}
                    className="whitespace-nowrap rounded-md border px-3 py-2 text-sm"
                >
                    {showNewExercise ? 'Cancel' : '+ New'}
                </button>
            </div>

            {showNewExercise && (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newExerciseName}
                        onChange={(e) => setNewExerciseName(e.target.value)}
                        placeholder={`New ${muscleGroup} exercise name`}
                        className="flex-1 rounded-md border px-3 py-2 text-sm"
                    />
                    <input
                        type="text"
                        value={newExerciseEquipment}
                        onChange={(e) => setNewExerciseEquipment(e.target.value)}
                        placeholder="Equipment (optional)"
                        className="w-40 rounded-md border px-3 py-2 text-sm"
                    />
                    <button
                        type="button"
                        onClick={handleCreateExercise}
                        disabled={isSaving}
                        className="whitespace-nowrap rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            )}
        </div>
    )
}