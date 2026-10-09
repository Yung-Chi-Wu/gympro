'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { toFriendlyError } from '@/lib/friendly-error'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { fieldValue, fitsLogType, hasWeight, isValidField, LOG_FIELDS, logTypeOf, toSetRow, toStoredSet, type FieldKey, type SetValues, type Units } from '@/lib/set-log'
import type { ExerciseOption } from './log-types'
import { exerciseLogUnits, findTodayWorkoutId, lastSessionSets, loadTodayWorkout, type TodayExercise } from '@/lib/today-workout'
import { cellText, compactSet, fieldLabel, SummaryLine } from './set-format'

interface TodayWorkoutCardProps {
    userId: string
    initialWorkoutId: string | null
    todayRange: { start: string; end: string }
    routineIdForToday: string | null
    isRestDay: boolean
    hasCycle: boolean
    dayIndex: number
    cycleLength: number
    initialExercises: TodayExercise[]
    allExercises: ExerciseOption[]
    language: string
    /** The reading unit (Settings); an exercise is logged in it until the user picks another kg/lb for that exercise */
    weightUnit: WeightUnit
    distanceUnit: DistanceUnit
    routineName: string | null
}

// Today's log: every exercise, strength or cardio, is a table of sets whose columns come from
// its log type (lib/set-log.ts). Last time's sets show as grey hints in the empty cells. An
// exercise folds to its name and summary; logging a set in another one folds the one before,
// so usually only the exercise in progress is open.
//
// kg/lb is chosen per exercise (some machines are in lb), remembered in exercise_log_units, and
// starts as the reading unit from Settings, which this card never changes. km/mi is one choice.

/** What opens first: the exercise logged last, and the next one not started after it (the first exercise before any set) */
function initialOpen(exercises: TodayExercise[]): { open: string[]; active: string | null } {
    const logged = exercises.flatMap((ex) => ex.loggedSets.map((s) => ({ id: ex.exerciseId, at: s.createdAt })))
    const active = logged.length ? logged.reduce((a, b) => (b.at > a.at ? b : a)).id : null
    const from = active ? exercises.findIndex((ex) => ex.exerciseId === active) : -1
    const next = exercises.slice(from + 1).find((ex) => !ex.loggedSets.length)
    return { open: [active, next?.exerciseId].filter((id): id is string => !!id), active }
}

export function TodayWorkoutCard({
    userId,
    initialWorkoutId,
    todayRange,
    routineIdForToday,
    isRestDay,
    hasCycle,
    dayIndex,
    cycleLength,
    initialExercises,
    allExercises,
    language,
    weightUnit: readingUnit,
    distanceUnit: initialDistanceUnit,
    routineName,
}: TodayWorkoutCardProps) {
    const t = useTranslations('today')
    const ts = useTranslations('sets')
    const supabase = createClient()
    const [workoutId, setWorkoutId] = useState<string | null>(initialWorkoutId)
    const [exercises, setExercises] = useState<TodayExercise[]>(initialExercises)
    const [showAddPicker, setShowAddPicker] = useState(false)
    const [toast, setToast] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(initialDistanceUnit)
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [openState, setOpenState] = useState(() => initialOpen(initialExercises))
    const unitsFor = (ex: TodayExercise): Units => ({ weight: ex.logUnit ?? readingUnit, distance: distanceUnit })

    // Ronnie changed today's workout or a routine: reload today the way the page does,
    // which also finds a workout Ronnie started before the user logged anything
    useEffect(() => {
        async function reload() {
            const today = await loadTodayWorkout(supabase, { userId, range: todayRange, routineId: routineIdForToday, language })
            setWorkoutId(today.workoutId)
            setExercises(today.exercises)
        }

        window.addEventListener('ronnie-workout-changed', reload)
        return () => window.removeEventListener('ronnie-workout-changed', reload)
    }, [userId, todayRange, routineIdForToday, language])

    function showToast(message: string) {
        setToast(message)
        setTimeout(() => setToast(null), 1800)
    }

    function toggleOpen(exerciseId: string) {
        setOpenState((s) => ({ ...s, open: s.open.includes(exerciseId) ? s.open.filter((id) => id !== exerciseId) : [...s.open, exerciseId] }))
    }

    /** This exercise's kg/lb, remembered for next time; the reading unit in Settings stays as it is */
    async function handleExerciseUnit(exerciseId: string, unit: WeightUnit) {
        setError(null)
        setExercises((prev) => prev.map((ex) => (ex.exerciseId === exerciseId ? { ...ex, logUnit: unit } : ex)))
        const { error: saveError } = await supabase
            .from('exercise_log_units')
            .upsert({ user_id: userId, exercise_id: exerciseId, unit, updated_at: new Date().toISOString() }, { onConflict: 'user_id,exercise_id' })
        if (saveError) setError(toFriendlyError(saveError, language))
    }

    async function handleDistanceUnit(next: DistanceUnit) {
        setDistanceUnit(next)
        await supabase.from('user_profiles').update({ distance_unit: next }).eq('user_id', userId)
    }

    /**
     * Today's workout and its exercises, creating the workout on the first set. Ronnie or another
     * tab may have started one since the page loaded, so look first and use the latest (the one
     * every reader of today's workout picks): a second workout would split today's log in two.
     */
    async function ensureWorkout(): Promise<{ id: string; exercises: TodayExercise[] }> {
        if (workoutId) return { id: workoutId, exercises }

        if (await findTodayWorkoutId(supabase, userId, todayRange)) {
            // That workout with its own planned exercises, not this page's list
            const today = await loadTodayWorkout(supabase, { userId, range: todayRange, routineId: routineIdForToday, language })
            if (today.workoutId) {
                setWorkoutId(today.workoutId)
                setExercises(today.exercises)
                return { id: today.workoutId, exercises: today.exercises }
            }
        }

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
            throw new Error(toFriendlyError(workoutError, language))
        }

        let planned = exercises
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
                throw new Error(toFriendlyError(plannedError, language))
            }

            const idByExercise = new Map(plannedRows.map((p) => [p.exercise_id, p.id]))
            planned = exercises.map((ex) => ({ ...ex, plannedRowId: idByExercise.get(ex.exerciseId) ?? ex.plannedRowId }))
            setExercises(planned)
        }

        setWorkoutId(workout.id)
        return { id: workout.id, exercises: planned }
    }

    /** Adds the exercise to today's workout; returns the list with it */
    async function planExercise(wId: string, current: TodayExercise[], exercise: Omit<TodayExercise, 'plannedRowId' | 'loggedSets'>): Promise<TodayExercise[]> {
        const { data, error: insertError } = await supabase
            .from('workout_planned_exercises')
            .insert({ workout_id: wId, exercise_id: exercise.exerciseId, user_id: userId })
            .select('id')
            .single()
        if (insertError || !data) throw new Error(toFriendlyError(insertError, language))
        return [...current, { ...exercise, plannedRowId: data.id, loggedSets: [] }]
    }

    async function handleAddSet(exerciseId: string, values: SetValues): Promise<boolean> {
        setError(null)
        try {
            const { id: wId, exercises: found } = await ensureWorkout()
            let current = found
            // A workout started elsewhere may not have this exercise yet
            if (!current.some((ex) => ex.exerciseId === exerciseId)) {
                const local = exercises.find((ex) => ex.exerciseId === exerciseId)
                if (local) current = await planExercise(wId, current, local)
            }
            const exercise = current.find((ex) => ex.exerciseId === exerciseId)
            // After the highest so far, so a set deleted in the middle doesn't make two of the same number
            const setNumber = Math.max(0, ...(exercise?.loggedSets ?? []).map((s) => s.setNumber)) + 1

            const { data, error: insertError } = await supabase
                .from('workout_sets')
                .insert({
                    workout_id: wId,
                    exercise_id: exerciseId,
                    user_id: userId,
                    set_number: setNumber,
                    ...toSetRow(values),
                })
                .select('id, created_at')
                .single()

            if (insertError || !data) {
                throw new Error(toFriendlyError(insertError, language))
            }

            setExercises(current.map((ex) =>
                ex.exerciseId !== exerciseId
                    ? ex
                    : { ...ex, loggedSets: [...ex.loggedSets, { ...values, id: data.id, setNumber, createdAt: data.created_at }] }
            ))
            // Moving on to another exercise folds the one before
            setOpenState((s) => {
                const folded = s.active !== exerciseId ? s.active : null
                return { active: exerciseId, open: [...s.open.filter((id) => id !== exerciseId && id !== folded), exerciseId] }
            })
            showToast('✓')
            return true
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
            return false
        }
    }

    async function handleDeleteSet(exerciseId: string, setId: string) {
        setError(null)
        const { error: deleteError } = await supabase.from('workout_sets').delete().eq('id', setId)
        if (deleteError) { setError(toFriendlyError(deleteError, language)); return }
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
            const { exercises: current } = await ensureWorkout()
            const plannedRowId = current.find((ex) => ex.exerciseId === exerciseId)?.plannedRowId
            if (!plannedRowId) return
            const { error: deleteError } = await supabase
                .from('workout_planned_exercises')
                .delete()
                .eq('id', plannedRowId)
            if (deleteError) throw new Error(toFriendlyError(deleteError, language))
            setExercises(current.filter((ex) => ex.exerciseId !== exerciseId))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
    }

    async function handleAddAdHocExercise(exercise: ExerciseOption) {
        setError(null)
        try {
            const { id: wId, exercises: current } = await ensureWorkout()
            if (!current.some((ex) => ex.exerciseId === exercise.id)) {
                const [previous, logUnits] = await Promise.all([
                    lastSessionSets(supabase, userId, [exercise.id], todayRange.start),
                    exerciseLogUnits(supabase, userId, [exercise.id]),
                ])
                setExercises(await planExercise(wId, current, {
                    exerciseId: exercise.id,
                    name: language === 'zh-TW' && exercise.name_zh_tw ? exercise.name_zh_tw : exercise.name,
                    muscleGroup: exercise.muscle_group,
                    logType: logTypeOf(exercise.log_type),
                    logUnit: logUnits.get(exercise.id) ?? null,
                    previous: previous.get(exercise.id) ?? [],
                }))
            }
            setOpenState((s) => ({ ...s, open: s.open.includes(exercise.id) ? s.open : [...s.open, exercise.id] }))
            setShowAddPicker(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
    }

    return (
        <div className="relative rounded-xl border border-ink/10 bg-white p-4 space-y-3">

            {/* Header */}
            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => setIsCollapsed((v) => !v)}
                    className="min-w-0 flex-1 text-left"
                >
                    <h2 className="text-lg font-semibold uppercase tracking-wide">{t('title')}</h2>
                    {routineName && (
                        <p className="text-sm font-medium text-ink/70 mt-0.5">{routineName}</p>
                    )}
                    {hasCycle && (
                        <span className="text-xs text-ink/40">
                            {language === 'zh-TW'
                                ? `第 ${dayIndex} 天 / 共 ${cycleLength} 天`
                                : `Day ${dayIndex} of ${cycleLength}`}
                        </span>
                    )}
                </button>

                <div className="flex items-center gap-2 shrink-0">
                    <UnitToggle label={ts('distanceUnit')} options={['km', 'mi'] as const} value={distanceUnit} onChange={handleDistanceUnit} />

                    {/* 摺疊按鈕 */}
                    <button
                        type="button"
                        onClick={() => setIsCollapsed((v) => !v)}
                        aria-expanded={!isCollapsed}
                        className="text-ink/30 hover:text-ink dark:text-white/30 dark:hover:text-white transition-colors p-1"
                    >
                        <Chevron closed={isCollapsed} size={16} />
                    </button>
                </div>
            </div>

            {/* 可摺疊內容 */}
            {!isCollapsed && (
                <>
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

                    <div>
                        {exercises.map((exercise) => (
                            <ExerciseBlock
                                key={exercise.exerciseId}
                                exercise={exercise}
                                isOpen={openState.open.includes(exercise.exerciseId)}
                                onToggle={() => toggleOpen(exercise.exerciseId)}
                                language={language}
                                units={unitsFor(exercise)}
                                onUnitChange={(unit) => handleExerciseUnit(exercise.exerciseId, unit)}
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
                </>
            )}

            {toast && (
                <div className="fixed bottom-6 right-6 rounded-md bg-plate px-4 py-2 text-sm text-chalk shadow-lg">
                    {toast}
                </div>
            )}
        </div>
    )
}

function Chevron({ closed, size }: { closed: boolean; size: number }) {
    return (
        <svg
            width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 transition-transform duration-150 motion-reduce:transition-none"
            style={{ transform: closed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

function UnitToggle<U extends string>({ label, options, value, onChange, small }: {
    label: string
    options: readonly U[]
    value: U
    onChange: (unit: U) => void
    small?: boolean
}) {
    return (
        <div role="group" aria-label={label} className={`flex shrink-0 rounded-lg overflow-hidden font-bold border border-ink/20 dark:border-white/20 ${small ? 'text-[11px]' : 'text-xs'}`}>
            {options.map((o, i) => (
                <Fragment key={o}>
                    {i > 0 && <div className="w-px bg-ink/20 dark:bg-white/20" />}
                    <button
                        type="button"
                        aria-pressed={value === o}
                        onClick={value !== o ? () => onChange(o) : undefined}
                        className={`${small ? 'px-2 py-1' : 'px-2.5 py-1.5'} transition-all ${value === o
                            ? 'bg-plate dark:bg-white text-chalk dark:text-[#1A1814]'
                            : 'bg-transparent text-ink/40 dark:text-white/40 hover:text-ink dark:hover:text-white'
                            }`}
                    >
                        {o}
                    </button>
                </Fragment>
            ))}
        </div>
    )
}

interface AddExercisePanelProps {
    exercises: ExerciseOption[]
    language: string
    onAdd: (exercise: ExerciseOption) => void
    onCancel: () => void
}

function AddExercisePanel({ exercises, language, onAdd, onCancel }: AddExercisePanelProps) {
    const t = useTranslations('today')
    const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? '')

    return (
        <div className="rounded-md border border-dashed p-3 space-y-2">
            <MuscleGroupExercisePicker
                exercises={exercises}
                value={selectedId}
                onChange={setSelectedId}
                language={language}
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

interface ExerciseBlockProps {
    exercise: TodayExercise
    isOpen: boolean
    onToggle: () => void
    language: string
    /** This exercise's kg/lb, and km/mi */
    units: Units
    onUnitChange: (unit: WeightUnit) => void
    onAddSet: (exerciseId: string, values: SetValues) => Promise<boolean>
    onDeleteSet: (exerciseId: string, setId: string) => void
    onRemove: (exerciseId: string) => void
}

/** One exercise: muscle group, name and summary, which fold the table away */
function ExerciseBlock({ exercise, isOpen, onToggle, language, units, onUnitChange, onAddSet, onDeleteSet, onRemove }: ExerciseBlockProps) {
    const t = useTranslations('today')
    const ts = useTranslations('sets')

    return (
        <div className="grid gap-2 py-3 border-t border-ink/10 first:border-t-0">
            <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={onToggle} aria-expanded={isOpen} className="min-w-0 flex-1 text-left">
                    <span className="block text-xs tracking-wider text-ink/40">
                        {getMuscleGroupLabel(exercise.muscleGroup, language)}
                    </span>
                    <span className="flex items-center gap-1.5 text-[17px] font-bold leading-snug">
                        <span className="text-ink/40"><Chevron closed={!isOpen} size={14} /></span>
                        <span className="truncate">{exercise.name}</span>
                    </span>
                    <span className="block text-sm text-ink/60">
                        <SummaryLine t={ts} logType={exercise.logType} sets={exercise.loggedSets} units={units} />
                    </span>
                </button>
                {isOpen && hasWeight(exercise.logType) && (
                    <UnitToggle small label={ts('logUnit', { name: exercise.name })} options={['kg', 'lb'] as const} value={units.weight} onChange={onUnitChange} />
                )}
                <button
                    type="button"
                    onClick={() => onRemove(exercise.exerciseId)}
                    className="shrink-0 text-sm text-ink/40 hover:text-red-600 active:opacity-50"
                >
                    {t('remove')}
                </button>
            </div>

            {/* Typed values are in the units shown, so switching units starts the row over */}
            {isOpen && <SetTable key={`${units.weight}-${units.distance}`} exercise={exercise} units={units} onAddSet={onAddSet} onDeleteSet={onDeleteSet} />}
        </div>
    )
}

const NUMBER = 'text-center font-mono text-sm font-bold text-ink/60'
const CELL = 'h-[34px] truncate rounded-[7px] bg-[#F3EFE6] px-1 text-center font-mono text-base font-bold leading-[34px] dark:bg-white/[0.06]'
const INPUT = 'h-[34px] min-h-0! w-full min-w-0 rounded-[7px] border border-[#E4DFD4] bg-white px-1 text-center font-mono text-base font-bold placeholder:font-medium placeholder:text-ink/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A9712F]'
const PLUS = 'h-[34px] w-9 rounded-[7px] bg-[#A9712F] text-xl leading-none text-white transition-colors disabled:bg-[#F4E7D6] disabled:text-ink/40 dark:bg-[#D9A35F] dark:text-[#1A1814] dark:disabled:bg-[#3A2E1F] dark:disabled:text-white/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A9712F]'
const WHOLE_NUMBERS = new Set<FieldKey>(['reps', 'seconds'])

/** The sets as a table: set number, the log type's columns, and delete or add */
function SetTable({ exercise, units, onAddSet, onDeleteSet }: {
    exercise: TodayExercise
    units: Units
    onAddSet: (exerciseId: string, values: SetValues) => Promise<boolean>
    onDeleteSet: (exerciseId: string, setId: string) => void
}) {
    const ts = useTranslations('sets')
    const fields = LOG_FIELDS[exercise.logType]
    const [draft, setDraft] = useState<string[]>(() => fields.map(() => ''))
    const [saving, setSaving] = useState(false)
    const firstInput = useRef<HTMLInputElement>(null)
    // One column template for every row, so the numbers, cells and buttons line up
    const grid = { gridTemplateColumns: `30px repeat(${fields.length}, minmax(0, 1fr)) 36px` }
    const next = exercise.loggedSets.length
    // Last time's set with the same number, as hints; none if it was logged another way
    const hint = exercise.previous[next] && fitsLogType(exercise.logType, exercise.previous[next]) ? exercise.previous[next] : null
    const ready = fields.every((key, i) => isValidField(key, draft[i]))

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!ready || saving) return
        setSaving(true)
        const saved = await onAddSet(exercise.exerciseId, toStoredSet(exercise.logType, draft.map(Number), units))
        setSaving(false)
        if (saved) {
            setDraft(fields.map(() => ''))
            firstInput.current?.focus()
        }
    }

    return (
        <div className="grid gap-1">
            <div className="mb-0.5 grid items-end gap-x-1.5 border-b border-ink/10 pb-1 text-center text-xs tracking-wide text-ink/40" style={grid}>
                <span>{ts('set')}</span>
                {fields.map((key) => <span key={key} className="truncate">{fieldLabel(ts, key, units)}</span>)}
                <span />
            </div>

            {exercise.loggedSets.map((s, i) => (
                <div key={s.id} className="grid min-h-[34px] items-center gap-x-1.5" style={grid}>
                    <span className={NUMBER}>{i + 1}</span>
                    {fitsLogType(exercise.logType, s)
                        ? fields.map((key) => <span key={key} className={CELL}>{cellText(ts, key, s, units)}</span>)
                        // Logged before this exercise had its columns: shown the way it was logged
                        : <span className={`${CELL} text-ink/60`} style={{ gridColumn: `span ${fields.length}` }}>{compactSet(ts, 'weight_reps', s, units)}</span>}
                    <button
                        type="button"
                        onClick={() => onDeleteSet(exercise.exerciseId, s.id)}
                        aria-label={ts('deleteSet', { n: i + 1 })}
                        className="h-[34px] w-9 text-lg text-ink/40 hover:text-red-600 active:opacity-50"
                    >
                        ×
                    </button>
                </div>
            ))}

            <form onSubmit={handleSubmit} className="grid min-h-[34px] items-center gap-x-1.5" style={grid}>
                <span className={NUMBER}>{next + 1}</span>
                {fields.map((key, i) => (
                    <input
                        key={key}
                        ref={i === 0 ? firstInput : undefined}
                        type="text"
                        inputMode={WHOLE_NUMBERS.has(key) ? 'numeric' : 'decimal'}
                        value={draft[i]}
                        onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
                        placeholder={hint ? String(fieldValue(key, hint, units) ?? '') : undefined}
                        aria-label={ts('fieldOfSet', { n: next + 1, field: fieldLabel(ts, key, units) })}
                        className={INPUT}
                    />
                ))}
                <button type="submit" disabled={!ready || saving} aria-label={ts('addSet', { n: next + 1 })} className={PLUS}>
                    ＋
                </button>
            </form>
        </div>
    )
}
