'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { toFriendlyError } from '@/lib/friendly-error'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import type { ExerciseOption } from './log-types'
import type { TodayExercise } from '@/app/(app)/dashboard/page'

interface TodayWorkoutCardProps {
    userId: string
    initialWorkoutId: string | null
    routineIdForToday: string | null
    isRestDay: boolean
    hasCycle: boolean
    dayIndex: number
    cycleLength: number
    initialExercises: TodayExercise[]
    allExercises: ExerciseOption[]
    language: string
}

export function TodayWorkoutCard({
    userId,
    initialWorkoutId,
    routineIdForToday,
    isRestDay,
    hasCycle,
    dayIndex,
    cycleLength,
    initialExercises,
    allExercises: initialAllExercises,
    language,
}: TodayWorkoutCardProps) {
    const t = useTranslations('today')
    const supabase = createClient()
    const [workoutId, setWorkoutId] = useState<string | null>(initialWorkoutId)
    const [exercises, setExercises] = useState<TodayExercise[]>(initialExercises)
    const [allExercises, setAllExercises] = useState<ExerciseOption[]>(initialAllExercises)
    const [showAddPicker, setShowAddPicker] = useState(false)
    const [toast, setToast] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    function showToast(message: string) {
        setToast(message)
        setTimeout(() => setToast(null), 1800)
    }

    async function ensureWorkout(): Promise<string> {
        if (workoutId) return workoutId

        const { data: workout, error: workoutError } = await supabase
            .from('workouts')
            .insert({
                user_id: userId,
                performed_at: new Date().toISOString(),
                routine_id: routineIdForToday,
            })
            .select('id')
            .single()

        if (workoutError || !workout) {
            throw new Error(toFriendlyError(workoutError))
        }

        if (exercises.length > 0) {
            const rows = exercises.map((ex) => ({
                workout_id: workout.id,
                exercise_id: ex.exerciseId,
                user_id: userId,
            }))
            const { data: plannedRows, error: plannedError } = await supabase
                .from('workout_planned_exercises')
                .insert(rows)
                .select('id, exercise_id')

            if (plannedError || !plannedRows) {
                throw new Error(toFriendlyError(plannedError))
            }

            const idByExercise = new Map(plannedRows.map((p) => [p.exercise_id, p.id]))
            setExercises((prev) =>
                prev.map((ex) => ({
                    ...ex,
                    plannedRowId: idByExercise.get(ex.exerciseId) ?? ex.plannedRowId,
                }))
            )
        }

        setWorkoutId(workout.id)
        return workout.id
    }

    async function handleAddSet(exerciseId: string, reps: number, weightKg: number) {
        setError(null)
        try {
            const wId = await ensureWorkout()
            const exercise = exercises.find((ex) => ex.exerciseId === exerciseId)
            const setNumber = (exercise?.loggedSets.length ?? 0) + 1

            const { data, error: insertError } = await supabase
                .from('workout_sets')
                .insert({
                    workout_id: wId,
                    exercise_id: exerciseId,
                    user_id: userId,
                    set_number: setNumber,
                    reps,
                    weight_kg: weightKg,
                })
                .select('id')
                .single()

            if (insertError || !data) {
                throw new Error(toFriendlyError(insertError))
            }

            setExercises((prev) =>
                prev.map((ex) =>
                    ex.exerciseId !== exerciseId
                        ? ex
                        : { ...ex, loggedSets: [...ex.loggedSets, { id: data.id, reps, weightKg }] }
                )
            )
            showToast('✓')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
    }

    async function handleDeleteSet(exerciseId: string, setId: string) {
        setError(null)
        const { error: deleteError } = await supabase.from('workout_sets').delete().eq('id', setId)
        if (deleteError) { setError(toFriendlyError(deleteError)); return }
        setExercises((prev) =>
            prev.map((ex) =>
                ex.exerciseId !== exerciseId
                    ? ex
                    : { ...ex, loggedSets: ex.loggedSets.filter((s) => s.id !== setId) }
            )
        )
    }

    async function handleRemoveExercise(exerciseId: string) {
        setError(null)
        try {
            await ensureWorkout()
            const plannedRowId = exercises.find((ex) => ex.exerciseId === exerciseId)?.plannedRowId
            if (!plannedRowId) return
            const { error: deleteError } = await supabase
                .from('workout_planned_exercises')
                .delete()
                .eq('id', plannedRowId)
            if (deleteError) throw new Error(toFriendlyError(deleteError))
            setExercises((prev) => prev.filter((ex) => ex.exerciseId !== exerciseId))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
    }

    async function handleAddAdHocExercise(exercise: ExerciseOption) {
        setError(null)
        try {
            const wId = await ensureWorkout()
            const { data, error: insertError } = await supabase
                .from('workout_planned_exercises')
                .insert({ workout_id: wId, exercise_id: exercise.id, user_id: userId })
                .select('id')
                .single()
            if (insertError || !data) throw new Error(toFriendlyError(insertError))
            setExercises((prev) => [
                ...prev,
                {
                    exerciseId: exercise.id,
                    name: exercise.name,
                    muscleGroup: exercise.muscle_group,
                    plannedRowId: data.id,
                    loggedSets: [],
                },
            ])
            setShowAddPicker(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
    }

    return (
        <div className="relative rounded-2xl border border-ink/10 bg-white p-6 space-y-4 shadow-sm">
            <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold uppercase tracking-wide">{t('title')}</h2>
                {hasCycle && (
                    <span className="text-sm text-ink/40">
                        {language === 'zh-TW'
                            ? `第 ${dayIndex} 天 / 共 ${cycleLength} 天`
                            : `Day ${dayIndex} of ${cycleLength}`}
                    </span>
                )}
            </div>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            {hasCycle && isRestDay && exercises.length === 0 && (
                <p className="text-sm text-ink/60">{t('restDay')}</p>
            )}
            {hasCycle && !isRestDay && exercises.length === 0 && (
                <p className="text-sm text-ink/60">{t('emptyRoutine')}</p>
            )}
            {!hasCycle && exercises.length === 0 && (
                <p className="text-sm text-ink/60">{t('emptyFree')}</p>
            )}

            <div className="space-y-4">
                {exercises.map((exercise) => (
                    <TodayExerciseRow
                        key={exercise.exerciseId}
                        exercise={exercise}
                        language={language}
                        onAddSet={handleAddSet}
                        onDeleteSet={handleDeleteSet}
                        onRemove={handleRemoveExercise}
                    />
                ))}
            </div>

            {showAddPicker ? (
                <AddExercisePanel
                    exercises={allExercises}
                    language={language}
                    onAdd={handleAddAdHocExercise}
                    onCancel={() => setShowAddPicker(false)}
                    onExerciseCreated={(exercise) => setAllExercises((prev) => [...prev, exercise])}
                />
            ) : (
                <button
                    type="button"
                    onClick={() => setShowAddPicker(true)}
                    className="w-full rounded-md border border-dashed px-4 py-2 text-sm text-ink/60 hover:border-ink/30 hover:text-ink"
                >
                    {t('addExercise')}
                </button>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 rounded-md bg-plate px-4 py-2 text-sm text-chalk shadow-lg">
                    {toast}
                </div>
            )}
        </div>
    )
}

interface AddExercisePanelProps {
    exercises: ExerciseOption[]
    language: string
    onAdd: (exercise: ExerciseOption) => void
    onCancel: () => void
    onExerciseCreated: (exercise: ExerciseOption) => void
}

function AddExercisePanel({ exercises, language, onAdd, onCancel, onExerciseCreated }: AddExercisePanelProps) {
    const t = useTranslations('today')
    const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? '')

    return (
        <div className="rounded-md border border-dashed p-3 space-y-2">
            <MuscleGroupExercisePicker
                exercises={exercises}
                value={selectedId}
                onChange={setSelectedId}
                language={language}
                onExerciseCreated={onExerciseCreated}
            />
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={!selectedId}
                    onClick={() => {
                        const exercise = exercises.find((ex) => ex.id === selectedId)
                        if (exercise) onAdd(exercise)
                    }}
                    className="flex-1 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                >
                    {t('addToToday')}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-md px-3 py-2 text-sm text-ink/40"
                >
                    {t('cancel')}
                </button>
            </div>
        </div>
    )
}

interface TodayExerciseRowProps {
    exercise: TodayExercise
    language: string
    onAddSet: (exerciseId: string, reps: number, weightKg: number) => void
    onDeleteSet: (exerciseId: string, setId: string) => void
    onRemove: (exerciseId: string) => void
}

function TodayExerciseRow({ exercise, language, onAddSet, onDeleteSet, onRemove }: TodayExerciseRowProps) {
    const t = useTranslations('today')
    const [reps, setReps] = useState('')
    const [weightKg, setWeightKg] = useState('')

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const repsNum = Number(reps)
        const weightNum = Number(weightKg)
        if (!reps || repsNum <= 0 || weightKg === '' || weightNum < 0) return
        onAddSet(exercise.exerciseId, repsNum, weightNum)
    }

    return (
        <div className="rounded-xl border border-ink/10 p-4 space-y-2">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs uppercase tracking-wide text-ink/40">
                        {getMuscleGroupLabel(exercise.muscleGroup, language)}
                    </p>
                    <p className="font-medium">{exercise.name}</p>
                </div>
                <button
                    type="button"
                    onClick={() => onRemove(exercise.exerciseId)}
                    className="text-sm text-ink/40 hover:text-red-600"
                >
                    {t('remove')}
                </button>
            </div>

            {exercise.loggedSets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {exercise.loggedSets.map((s) => (
                        <span
                            key={s.id}
                            className="inline-flex items-center gap-2 rounded-full bg-plate/10 px-3 py-1 font-mono text-xs"
                        >
                            {s.weightKg}kg×{s.reps}
                            <button
                                type="button"
                                onClick={() => onDeleteSet(exercise.exerciseId, s.id)}
                                aria-label="Remove set"
                                className="text-ink/40 hover:text-red-600"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                    type="number"
                    min={1}
                    placeholder={t('reps')}
                    value={reps}
                    onChange={(e) => setReps(e.target.value)}
                    className="w-20 rounded-md border px-2 py-1 text-sm"
                />
                <input
                    type="number"
                    step="0.5"
                    min={0}
                    placeholder={t('kg')}
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    className="w-20 rounded-md border px-2 py-1 text-sm"
                />
                <button type="submit" className="rounded-md border px-3 py-1 text-sm">
                    {t('add')}
                </button>
            </form>
        </div>
    )
}