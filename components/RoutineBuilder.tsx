'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { toFriendlyError } from '@/lib/friendly-error'
import type { ExerciseOption } from './log-types'
import type { RoutineWithExercises, RoutineExerciseRow } from '@/app/(app)/routines/page'

interface RoutineBuilderProps {
    userId: string
    exercises: ExerciseOption[]
    initialRoutines: RoutineWithExercises[]
}

export function RoutineBuilder({ userId, exercises: initialExercises, initialRoutines }: RoutineBuilderProps) {
    const supabase = createClient()
    const router = useRouter()
    const [routines, setRoutines] = useState<RoutineWithExercises[]>(initialRoutines)
    const [exercises, setExercises] = useState<ExerciseOption[]>(initialExercises)
    const [newRoutineName, setNewRoutineName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [expandedRoutineId, setExpandedRoutineId] = useState<string | null>(null)

    async function handleCreateRoutine(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        const trimmedName = newRoutineName.trim()
        if (!trimmedName) return

        const isDuplicate = routines.some(
            (r) => r.name.trim().toLowerCase() === trimmedName.toLowerCase()
        )
        if (isDuplicate) {
            setError(`You already have a routine named "${trimmedName}".`)
            return
        }

        const { data, error: insertError } = await supabase
            .from('routines')
            .insert({ user_id: userId, name: trimmedName })
            .select('id, name')
            .single()

        if (insertError || !data) {
            setError(toFriendlyError(insertError))
            return
        }

        setRoutines((prev) => [...prev, { id: data.id, name: data.name, exercises: [] }])
        setNewRoutineName('')
        setExpandedRoutineId(data.id)
        router.refresh()
    }

    async function handleDeleteRoutine(routineId: string) {
        setError(null)
        const { error: deleteError } = await supabase.from('routines').delete().eq('id', routineId)

        if (deleteError) {
            setError(toFriendlyError(deleteError))
            return
        }
        setRoutines((prev) => prev.filter((r) => r.id !== routineId))
        router.refresh()
    }

    async function handleAddExercise(
        routineId: string,
        exercise: ExerciseOption,
        targetSets: number,
        targetReps: number
    ) {
        setError(null)
        const routine = routines.find((r) => r.id === routineId)
        if (!routine) return

        if (routine.exercises.some((ex) => ex.exercise_id === exercise.id)) {
            setError(`${exercise.name} is already in this routine.`)
            return
        }

        const nextOrderIndex = routine.exercises.length

        const { data, error: insertError } = await supabase
            .from('routine_exercises')
            .insert({
                routine_id: routineId,
                exercise_id: exercise.id,
                order_index: nextOrderIndex,
                target_sets: targetSets,
                target_reps: targetReps,
            })
            .select('id, exercise_id, order_index, target_sets, target_reps')
            .single()

        if (insertError || !data) {
            setError(toFriendlyError(insertError))
            return
        }

        setRoutines((prev) =>
            prev.map((r) =>
                r.id !== routineId
                    ? r
                    : {
                        ...r,
                        exercises: [
                            ...r.exercises,
                            {
                                id: data.id,
                                exercise_id: data.exercise_id,
                                exercise_name: exercise.name,
                                muscle_group: exercise.muscle_group,
                                order_index: data.order_index,
                                target_sets: data.target_sets,
                                target_reps: data.target_reps,
                            },
                        ],
                    }
            )
        )
    }

    async function handleRemoveExercise(routineId: string, routineExerciseId: string) {
        setError(null)
        const { error: deleteError } = await supabase
            .from('routine_exercises')
            .delete()
            .eq('id', routineExerciseId)

        if (deleteError) {
            setError(toFriendlyError(deleteError))
            return
        }

        setRoutines((prev) =>
            prev.map((r) =>
                r.id !== routineId
                    ? r
                    : { ...r, exercises: r.exercises.filter((ex) => ex.id !== routineExerciseId) }
            )
        )
    }

    async function handleUpdateTarget(
        routineId: string,
        routineExerciseId: string,
        targetSets: number,
        targetReps: number
    ) {
        setError(null)
        const { error: updateError } = await supabase
            .from('routine_exercises')
            .update({ target_sets: targetSets, target_reps: targetReps })
            .eq('id', routineExerciseId)

        if (updateError) {
            setError(toFriendlyError(updateError))
            return
        }

        setRoutines((prev) =>
            prev.map((r) =>
                r.id !== routineId
                    ? r
                    : {
                        ...r,
                        exercises: r.exercises.map((ex) =>
                            ex.id !== routineExerciseId
                                ? ex
                                : { ...ex, target_sets: targetSets, target_reps: targetReps }
                        ),
                    }
            )
        )
    }

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-semibold uppercase tracking-wide">Your Routines</h2>

            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}

            <form onSubmit={handleCreateRoutine} className="flex gap-2">
                <input
                    type="text"
                    value={newRoutineName}
                    onChange={(e) => setNewRoutineName(e.target.value)}
                    placeholder="e.g. Push Day"
                    className="flex-1 rounded-md border px-3 py-2 text-sm"
                />
                <button
                    type="submit"
                    className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light"
                >
                    New Routine
                </button>
            </form>

            <div className="space-y-2">
                {routines.map((routine) => {
                    const isExpanded = expandedRoutineId === routine.id
                    return (
                        <div
                            key={routine.id}
                            className="rounded-2xl border border-ink/10 bg-white shadow-sm"
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    setExpandedRoutineId(isExpanded ? null : routine.id)
                                }
                                className="flex w-full items-center justify-between p-4 text-left"
                            >
                                <span className="font-medium">{routine.name}</span>
                                <span className="text-sm text-ink/40">
                                    {routine.exercises.length}{' '}
                                    {routine.exercises.length === 1 ? 'exercise' : 'exercises'}
                                    {' '}
                                    <span className="ml-1">{isExpanded ? '▲' : '▼'}</span>
                                </span>
                            </button>

                            {isExpanded && (
                                <div className="border-t border-ink/10 p-6 space-y-3">
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteRoutine(routine.id)}
                                            className="text-sm text-ink/40 hover:text-red-600"
                                        >
                                            Delete routine
                                        </button>
                                    </div>

                                    {routine.exercises.length > 0 && (
                                        <div className="space-y-2">
                                            {routine.exercises.map((ex) => (
                                                <ExistingExerciseRow
                                                    key={ex.id}
                                                    exercise={ex}
                                                    onUpdateTarget={(sets, reps) =>
                                                        handleUpdateTarget(routine.id, ex.id, sets, reps)
                                                    }
                                                    onRemove={() =>
                                                        handleRemoveExercise(routine.id, ex.id)
                                                    }
                                                />
                                            ))}
                                        </div>
                                    )}

                                    <AddExerciseToRoutine
                                        exercises={exercises}
                                        onAdd={(exercise, targetSets, targetReps) =>
                                            handleAddExercise(
                                                routine.id,
                                                exercise,
                                                targetSets,
                                                targetReps
                                            )
                                        }
                                        onExerciseCreated={(exercise) =>
                                            setExercises((prev) => [...prev, exercise])
                                        }
                                    />
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </section>
    )
}

interface ExistingExerciseRowProps {
    exercise: RoutineExerciseRow
    onUpdateTarget: (targetSets: number, targetReps: number) => void
    onRemove: () => void
}

function ExistingExerciseRow({ exercise, onUpdateTarget, onRemove }: ExistingExerciseRowProps) {
    const [targetSets, setTargetSets] = useState(String(exercise.target_sets ?? ''))
    const [targetReps, setTargetReps] = useState(String(exercise.target_reps ?? ''))

    function commitIfChanged() {
        const setsNum = Number(targetSets)
        const repsNum = Number(targetReps)
        if (!setsNum || !repsNum || setsNum <= 0 || repsNum <= 0) return

        if (setsNum !== exercise.target_sets || repsNum !== exercise.target_reps) {
            onUpdateTarget(setsNum, repsNum)
        }
    }

    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span>
                <span className="text-ink/40 capitalize">{exercise.muscle_group}</span>
                {' — '}
                {exercise.exercise_name}
            </span>
            <div className="flex items-center gap-1 shrink-0">
                <input
                    type="number"
                    min={1}
                    value={targetSets}
                    onChange={(e) => setTargetSets(e.target.value)}
                    onBlur={commitIfChanged}
                    className="w-14 rounded-md border px-2 py-1 text-sm"
                />
                <span className="text-ink/40">×</span>
                <input
                    type="number"
                    min={1}
                    value={targetReps}
                    onChange={(e) => setTargetReps(e.target.value)}
                    onBlur={commitIfChanged}
                    className="w-14 rounded-md border px-2 py-1 text-sm"
                />
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label="Remove from routine"
                    className="ml-2 rounded-md border border-transparent px-1.5 py-0.5 text-ink/40 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                    ✕
                </button>
            </div>
        </div>
    )
}

interface AddExerciseToRoutineProps {
    exercises: ExerciseOption[]
    onAdd: (exercise: ExerciseOption, targetSets: number, targetReps: number) => void
    onExerciseCreated: (exercise: ExerciseOption) => void
}

function AddExerciseToRoutine({ exercises, onAdd, onExerciseCreated }: AddExerciseToRoutineProps) {
    const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? '')
    const [targetSets, setTargetSets] = useState('3')
    const [targetReps, setTargetReps] = useState('10')

    return (
        <div className="space-y-2 border-t border-ink/10 pt-3">
            <MuscleGroupExercisePicker
                exercises={exercises}
                value={selectedId}
                onChange={setSelectedId}
                onExerciseCreated={onExerciseCreated}
            />
            <div className="flex gap-2">
                <input
                    type="number"
                    min={1}
                    value={targetSets}
                    onChange={(e) => setTargetSets(e.target.value)}
                    placeholder="Sets"
                    className="w-20 rounded-md border px-2 py-1 text-sm"
                />
                <span className="self-center text-sm text-ink/40">×</span>
                <input
                    type="number"
                    min={1}
                    value={targetReps}
                    onChange={(e) => setTargetReps(e.target.value)}
                    placeholder="Reps"
                    className="w-20 rounded-md border px-2 py-1 text-sm"
                />
                <button
                    type="button"
                    disabled={!selectedId}
                    onClick={() => {
                        const exercise = exercises.find((ex) => ex.id === selectedId)
                        const setsNum = Number(targetSets)
                        const repsNum = Number(targetReps)
                        if (exercise && setsNum > 0 && repsNum > 0) {
                            onAdd(exercise, setsNum, repsNum)
                        }
                    }}
                    className="flex-1 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                >
                    Add
                </button>
            </div>
        </div>
    )
}