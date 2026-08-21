'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { toFriendlyError } from '@/lib/friendly-error'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import type { ExerciseOption } from './log-types'
import type { RoutineWithExercises, RoutineExerciseRow } from '@/app/(app)/routines/page'

interface RoutineBuilderProps {
    userId: string
    exercises: ExerciseOption[]
    initialRoutines: RoutineWithExercises[]
    language: string
}

export function RoutineBuilder({ userId, exercises, initialRoutines, language }: RoutineBuilderProps) {
    const supabase = createClient()
    const router = useRouter()
    const t = useTranslations('routines')
    const zh = language === 'zh-TW'
    const [routines, setRoutines] = useState<RoutineWithExercises[]>(initialRoutines)
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
            setError(
                zh
                    ? `你已經有一個叫「${trimmedName}」的課表了。`
                    : `You already have a routine named "${trimmedName}".`
            )
            return
        }

        const { data, error: insertError } = await supabase
            .from('routines')
            .insert({ user_id: userId, name: trimmedName })
            .select('id, name')
            .single()

        if (insertError || !data) {
            setError(toFriendlyError(insertError, language))
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
        if (deleteError) { setError(toFriendlyError(deleteError, language)); return }
        setRoutines((prev) => prev.filter((r) => r.id !== routineId))
        if (expandedRoutineId === routineId) setExpandedRoutineId(null)
        router.refresh()
    }

    async function handleRenameRoutine(routineId: string, newName: string) {
        setError(null)
        const trimmedName = newName.trim()
        if (!trimmedName) return

        const isDuplicate = routines.some(
            (r) => r.id !== routineId && r.name.trim().toLowerCase() === trimmedName.toLowerCase()
        )
        if (isDuplicate) {
            setError(
                zh
                    ? `你已經有一個叫「${trimmedName}」的課表了。`
                    : `You already have a routine named "${trimmedName}".`
            )
            return
        }

        const { error: updateError } = await supabase
            .from('routines')
            .update({ name: trimmedName })
            .eq('id', routineId)

        if (updateError) { setError(toFriendlyError(updateError, language)); return }

        setRoutines((prev) =>
            prev.map((r) => (r.id === routineId ? { ...r, name: trimmedName } : r))
        )
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

        // 前端防重複：用 exercise_id 比對，不管名字
        if (routine.exercises.some((ex) => ex.exercise_id === exercise.id)) {
            const name = zh && exercise.name_zh_tw ? exercise.name_zh_tw : exercise.name
            setError(
                zh
                    ? `「${name}」已經在這份課表裡了。`
                    : `${exercise.name} is already in this routine.`
            )
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
            // 23505 = unique violation，代表這個動作已經在課表裡（資料庫層攔截）
            if (insertError?.code === '23505') {
                const name = zh && exercise.name_zh_tw ? exercise.name_zh_tw : exercise.name
                setError(
                    zh
                        ? `「${name}」已經在這份課表裡了。`
                        : `${exercise.name} is already in this routine.`
                )
            } else {
                setError(toFriendlyError(insertError, language))
            }
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
        if (deleteError) { setError(toFriendlyError(deleteError, language)); return }
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
        if (updateError) { setError(toFriendlyError(updateError, language)); return }
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
            <h2 className="text-lg font-semibold uppercase tracking-wide">{t('yourRoutines')}</h2>

            {error && (
                <p role="alert" className="text-sm text-red-600">{error}</p>
            )}

            <form onSubmit={handleCreateRoutine} className="flex gap-2">
                <input
                    type="text"
                    value={newRoutineName}
                    onChange={(e) => setNewRoutineName(e.target.value)}
                    placeholder={t('newRoutinePlaceholder')}
                    className="flex-1 rounded-md border px-3 py-2 text-sm"
                />
                <button
                    type="submit"
                    className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light"
                >
                    {t('newRoutine')}
                </button>
            </form>

            <div className="space-y-2">
                {routines.map((routine) => {
                    const isExpanded = expandedRoutineId === routine.id
                    return (
                        <div key={routine.id} className="rounded-2xl border border-ink/10 bg-white shadow-sm">
                            <button
                                type="button"
                                onClick={() => setExpandedRoutineId(isExpanded ? null : routine.id)}
                                className="flex w-full items-center justify-between p-4 text-left"
                            >
                                <span className="font-medium">{routine.name}</span>
                                <span className="flex items-center gap-2 text-sm text-ink/40 shrink-0">
                                    {routine.exercises.length}{' '}
                                    {routine.exercises.length === 1 ? t('exercise') : t('exercises')}
                                    {' '}
                                    <span className="ml-1">{isExpanded ? '▲' : '▼'}</span>
                                </span>
                            </button>

                            {isExpanded && (
                                <div className="border-t border-ink/10 p-4 space-y-3">
                                    <RoutineNameEditor
                                        currentName={routine.name}
                                        language={language}
                                        onSave={(newName) => handleRenameRoutine(routine.id, newName)}
                                        onDelete={() => handleDeleteRoutine(routine.id)}
                                    />

                                    {routine.exercises.length > 0 && (
                                        <div className="space-y-2">
                                            {routine.exercises.map((ex) => (
                                                <ExistingExerciseRow
                                                    key={ex.id}
                                                    exercise={ex}
                                                    language={language}
                                                    exercises={exercises}
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
                                        language={language}
                                        onAdd={(exercise, targetSets, targetReps) =>
                                            handleAddExercise(routine.id, exercise, targetSets, targetReps)
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

interface RoutineNameEditorProps {
    currentName: string
    language: string
    onSave: (newName: string) => void
    onDelete: () => void
}

function RoutineNameEditor({ currentName, language, onSave, onDelete }: RoutineNameEditorProps) {
    const zh = language === 'zh-TW'
    const [isEditing, setIsEditing] = useState(false)
    const [name, setName] = useState(currentName)

    function commit() {
        if (name.trim() && name.trim() !== currentName) {
            onSave(name)
        } else {
            setName(currentName)
        }
        setIsEditing(false)
    }

    if (isEditing) {
        return (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <input
                    type="text"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') { setName(currentName); setIsEditing(false) }
                    }}
                    className="flex-1 rounded-md border px-3 py-2 text-sm font-medium"
                />
                <button
                    type="button"
                    onClick={onDelete}
                    className="text-sm text-ink/40 hover:text-red-600 sm:shrink-0"
                >
                    {zh ? '刪除課表' : 'Delete routine'}
                </button>
            </div>
        )
    }

    return (
        <div className="flex items-center justify-between">
            <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 text-left"
                aria-label="Edit routine name"
            >
                <span className="font-medium">{currentName}</span>
                <span className="text-ink/40">✎</span>
            </button>
            <button
                type="button"
                onClick={onDelete}
                className="text-sm text-ink/40 hover:text-red-600"
            >
                {zh ? '刪除課表' : 'Delete routine'}
            </button>
        </div>
    )
}

interface ExistingExerciseRowProps {
    exercise: RoutineExerciseRow
    language: string
    exercises: ExerciseOption[]
    onUpdateTarget: (targetSets: number, targetReps: number) => void
    onRemove: () => void
}

function ExistingExerciseRow({ exercise, language, exercises, onUpdateTarget, onRemove }: ExistingExerciseRowProps) {
    const t = useTranslations('routines')
    const [targetSets, setTargetSets] = useState(String(exercise.target_sets ?? ''))
    const [targetReps, setTargetReps] = useState(String(exercise.target_reps ?? ''))

    const displayName = (() => {
        if (language !== 'zh-TW') return exercise.exercise_name
        const found = exercises.find((ex) => ex.id === exercise.exercise_id)
        return found?.name_zh_tw ? found.name_zh_tw : exercise.exercise_name
    })()

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
            <span className="min-w-0 truncate">
                <span className="text-ink/40">
                    {getMuscleGroupLabel(exercise.muscle_group, language)}
                </span>
                {' — '}
                {displayName}
            </span>
            <div className="flex items-center gap-1 shrink-0">
                <div className="flex flex-col items-center">
                    <span className="text-xs text-ink/40">{t('sets')}</span>
                    <input
                        type="number"
                        min={1}
                        value={targetSets}
                        onChange={(e) => setTargetSets(e.target.value)}
                        onBlur={commitIfChanged}
                        className="w-14 rounded-md border px-2 py-1 text-sm text-center"
                    />
                </div>
                <span className="text-ink/40 mt-4">×</span>
                <div className="flex flex-col items-center">
                    <span className="text-xs text-ink/40">{t('reps')}</span>
                    <input
                        type="number"
                        min={1}
                        value={targetReps}
                        onChange={(e) => setTargetReps(e.target.value)}
                        onBlur={commitIfChanged}
                        className="w-14 rounded-md border px-2 py-1 text-sm text-center"
                    />
                </div>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label="Remove from routine"
                    className="ml-2 mt-4 rounded-md border border-transparent px-1.5 py-0.5 text-ink/40 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                    ✕
                </button>
            </div>
        </div>
    )
}

interface AddExerciseToRoutineProps {
    exercises: ExerciseOption[]
    language: string
    onAdd: (exercise: ExerciseOption, targetSets: number, targetReps: number) => void
}

function AddExerciseToRoutine({ exercises, language, onAdd }: AddExerciseToRoutineProps) {
    const t = useTranslations('routines')
    const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? '')
    const [targetSets, setTargetSets] = useState('3')
    const [targetReps, setTargetReps] = useState('10')

    return (
        <div className="space-y-2 border-t border-ink/10 pt-3">
            <MuscleGroupExercisePicker
                exercises={exercises}
                value={selectedId}
                onChange={setSelectedId}
                language={language}
            />
            <div className="flex gap-2 items-end">
                <div className="flex flex-col items-center">
                    <span className="text-xs text-ink/40">{t('sets')}</span>
                    <input
                        type="number"
                        min={1}
                        value={targetSets}
                        onChange={(e) => setTargetSets(e.target.value)}
                        className="w-16 rounded-md border px-2 py-1 text-sm text-center"
                    />
                </div>
                <span className="pb-1 text-sm text-ink/40">×</span>
                <div className="flex flex-col items-center">
                    <span className="text-xs text-ink/40">{t('reps')}</span>
                    <input
                        type="number"
                        min={1}
                        value={targetReps}
                        onChange={(e) => setTargetReps(e.target.value)}
                        className="w-16 rounded-md border px-2 py-1 text-sm text-center"
                    />
                </div>
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
                    className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                >
                    {t('add')}
                </button>
            </div>
        </div>
    )
}