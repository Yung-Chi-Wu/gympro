'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { MUSCLE_GROUPS, type ExerciseOption, type LoggedSet } from './log-types'

interface WorkoutLogFormProps {
    userId: string
    initialWorkoutId: string | null
    initialSets: LoggedSet[]
    exercises: ExerciseOption[]
}

export function WorkoutLogForm({
    userId,
    initialWorkoutId,
    initialSets,
    exercises: initialExercises,
}: WorkoutLogFormProps) {
    const supabase = createClient()

    const [workoutId, setWorkoutId] = useState<string | null>(initialWorkoutId)
    const [sets, setSets] = useState<LoggedSet[]>(initialSets)
    const [exercises, setExercises] = useState<ExerciseOption[]>(initialExercises)

    const [selectedExerciseId, setSelectedExerciseId] = useState(initialExercises[0]?.id ?? '')
    const [reps, setReps] = useState('')
    const [weightKg, setWeightKg] = useState('')
    const [rpe, setRpe] = useState('')
    const [isWarmup, setIsWarmup] = useState(false)

    const [showNewExercise, setShowNewExercise] = useState(false)
    const [newExerciseName, setNewExerciseName] = useState('')
    const [newExerciseMuscleGroup, setNewExerciseMuscleGroup] = useState<string>(MUSCLE_GROUPS[0])
    const [newExerciseEquipment, setNewExerciseEquipment] = useState('')

    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function ensureWorkout(): Promise<string> {
        if (workoutId) return workoutId

        const { data, error: insertError } = await supabase
            .from('workouts')
            .insert({ user_id: userId, performed_at: new Date().toISOString() })
            .select('id')
            .single()

        if (insertError || !data) {
            throw new Error(insertError?.message ?? 'Failed to start a workout')
        }

        setWorkoutId(data.id)
        return data.id
    }

    async function handleAddSet(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        const repsNum = Number(reps)
        const weightNum = Number(weightKg)
        const rpeNum = rpe ? Number(rpe) : null

        if (!selectedExerciseId) {
            setError('Pick an exercise first.')
            return
        }
        if (!reps || repsNum <= 0) {
            setError('Reps must be greater than 0.')
            return
        }
        if (weightKg === '' || weightNum < 0) {
            setError('Enter a valid weight (0 is fine for bodyweight).')
            return
        }

        setIsSaving(true)
        try {
            const wId = await ensureWorkout()
            const setNumber = sets.filter((s) => s.exerciseId === selectedExerciseId).length + 1

            const { data, error: insertError } = await supabase
                .from('workout_sets')
                .insert({
                    workout_id: wId,
                    exercise_id: selectedExerciseId,
                    user_id: userId,
                    set_number: setNumber,
                    reps: repsNum,
                    weight_kg: weightNum,
                    rpe: rpeNum,
                    is_warmup: isWarmup,
                })
                .select('id')
                .single()

            if (insertError || !data) {
                throw new Error(insertError?.message ?? 'Failed to save set')
            }

            const exerciseName = exercises.find((ex) => ex.id === selectedExerciseId)?.name ?? 'Unknown exercise'

            setSets((prev) => [
                ...prev,
                {
                    id: data.id,
                    exerciseId: selectedExerciseId,
                    exerciseName,
                    setNumber,
                    reps: repsNum,
                    weightKg: weightNum,
                    rpe: rpeNum,
                    isWarmup,
                },
            ])
            setRpe('')
            setIsWarmup(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        } finally {
            setIsSaving(false)
        }
    }

    async function handleDeleteSet(setId: string) {
        setError(null)
        const { error: deleteError } = await supabase.from('workout_sets').delete().eq('id', setId)

        if (deleteError) {
            setError(deleteError.message)
            return
        }
        setSets((prev) => prev.filter((s) => s.id !== setId))
    }

    async function handleCreateExercise(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (!newExerciseName.trim()) {
            setError('Give the exercise a name.')
            return
        }

        setIsSaving(true)
        try {
            const { data, error: insertError } = await supabase
                .from('exercises')
                .insert({
                    name: newExerciseName.trim(),
                    muscle_group: newExerciseMuscleGroup,
                    equipment: newExerciseEquipment.trim() || null,
                    is_custom: true,
                    created_by: userId,
                })
                .select('id, name, muscle_group, equipment')
                .single()

            if (insertError || !data) {
                throw new Error(insertError?.message ?? 'Failed to add exercise')
            }

            setExercises((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
            setSelectedExerciseId(data.id)
            setNewExerciseName('')
            setNewExerciseEquipment('')
            setShowNewExercise(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        } finally {
            setIsSaving(false)
        }
    }

    const groupedSets = groupByExercise(sets)

    return (
        <div className="space-y-6">
            {groupedSets.length > 0 && (
                <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm">
                    <h2 className="text-sm font-semibold text-ink/60 uppercase tracking-wide">
                        Logged So Far
                    </h2>
                    {groupedSets.map(([exerciseId, exerciseSets]) => (
                        <div key={exerciseId} className="text-sm space-y-1">
                            <span className="font-medium">{exerciseSets[0].exerciseName}</span>
                            <div className="flex flex-wrap gap-2">
                                {exerciseSets.map((s) => (
                                    <span
                                        key={s.id}
                                        className="inline-flex items-center gap-2 rounded-full bg-plate/10 px-3 py-1 font-mono text-xs"
                                    >
                                        {s.weightKg}kg×{s.reps}
                                        {s.isWarmup && <span className="text-ink/40">(warmup)</span>}
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteSet(s.id)}
                                            aria-label="Remove set"
                                            className="text-ink/40 hover:text-red-600"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <form
                onSubmit={handleAddSet}
                className="rounded-2xl border border-ink/10 bg-white p-6 space-y-4 shadow-sm"
            >
                <h2 className="text-sm font-semibold text-ink/60 uppercase tracking-wide">Add a Set</h2>

                {error && (
                    <p role="alert" className="text-sm text-red-600">
                        {error}
                    </p>
                )}

                <div className="space-y-1">
                    <label className="text-sm font-medium">Exercise</label>
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <MuscleGroupExercisePicker
                                exercises={exercises}
                                value={selectedExerciseId}
                                onChange={setSelectedExerciseId}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowNewExercise((v) => !v)}
                            className="whitespace-nowrap rounded-md border px-3 py-2 text-sm"
                        >
                            {showNewExercise ? 'Cancel' : '+ New'}
                        </button>
                    </div>
                </div>

                {showNewExercise && (
                    <div className="space-y-3 rounded-md border border-dashed p-3">
                        <div className="space-y-1">
                            <label htmlFor="newExerciseName" className="text-sm font-medium">
                                New exercise name
                            </label>
                            <input
                                id="newExerciseName"
                                type="text"
                                value={newExerciseName}
                                onChange={(e) => setNewExerciseName(e.target.value)}
                                placeholder="e.g. Incline Dumbbell Press"
                                className="w-full rounded-md border px-3 py-2 text-sm"
                            />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1 space-y-1">
                                <label htmlFor="newExerciseMuscleGroup" className="text-sm font-medium">
                                    Muscle group
                                </label>
                                <select
                                    id="newExerciseMuscleGroup"
                                    value={newExerciseMuscleGroup}
                                    onChange={(e) => setNewExerciseMuscleGroup(e.target.value)}
                                    className="w-full rounded-md border px-3 py-2 text-sm capitalize"
                                >
                                    {MUSCLE_GROUPS.map((mg) => (
                                        <option key={mg} value={mg}>
                                            {mg}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex-1 space-y-1">
                                <label htmlFor="newExerciseEquipment" className="text-sm font-medium">
                                    Equipment (optional)
                                </label>
                                <input
                                    id="newExerciseEquipment"
                                    type="text"
                                    value={newExerciseEquipment}
                                    onChange={(e) => setNewExerciseEquipment(e.target.value)}
                                    placeholder="e.g. Dumbbell"
                                    className="w-full rounded-md border px-3 py-2 text-sm"
                                />
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleCreateExercise}
                            disabled={isSaving}
                            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        >
                            Save Exercise
                        </button>
                    </div>
                )}

                <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                        <label htmlFor="reps" className="text-sm font-medium">
                            Reps
                        </label>
                        <input
                            id="reps"
                            type="number"
                            min={1}
                            value={reps}
                            onChange={(e) => setReps(e.target.value)}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex-1 space-y-1">
                        <label htmlFor="weightKg" className="text-sm font-medium">
                            Weight (kg)
                        </label>
                        <input
                            id="weightKg"
                            type="number"
                            step="0.5"
                            min={0}
                            value={weightKg}
                            onChange={(e) => setWeightKg(e.target.value)}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex-1 space-y-1">
                        <label htmlFor="rpe" className="text-sm font-medium">
                            RPE (optional)
                        </label>
                        <input
                            id="rpe"
                            type="number"
                            step="0.5"
                            min={1}
                            max={10}
                            value={rpe}
                            onChange={(e) => setRpe(e.target.value)}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={isWarmup}
                        onChange={(e) => setIsWarmup(e.target.checked)}
                    />
                    This is a warmup set
                </label>

                <button
                    type="submit"
                    disabled={isSaving || exercises.length === 0}
                    className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Add Set'}
                </button>
            </form>
        </div>
    )
}

function groupByExercise(sets: LoggedSet[]): [string, LoggedSet[]][] {
    const order: string[] = []
    const groups = new Map<string, LoggedSet[]>()

    for (const s of sets) {
        if (!groups.has(s.exerciseId)) {
            groups.set(s.exerciseId, [])
            order.push(s.exerciseId)
        }
        groups.get(s.exerciseId)!.push(s)
    }

    for (const group of groups.values()) {
        group.sort((a, b) => a.setNumber - b.setNumber)
    }

    return order.map((exerciseId) => [exerciseId, groups.get(exerciseId)!])
}