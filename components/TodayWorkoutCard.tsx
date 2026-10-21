'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { toFriendlyError } from '@/lib/friendly-error'
import { reportClientError } from '@/lib/report-client-error'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { fieldValue, fitsLogType, isValidField, isWeightField, LOG_FIELDS, logNoteOf, logTypeOf, toSetRow, toStoredSet, unitsOfSet, withField, type FieldKey, type SetValues, type Units } from '@/lib/set-log'
import type { ExerciseOption } from './log-types'
import { dayIsOver, DayOverError, exerciseLogUnits, lastSessionSets, loadTodayWorkout, startTodayWorkout, type TodayExercise } from '@/lib/today-workout'
import { cellText, compactSet, fieldLabel, SummaryLine } from './set-format'
import { DayLogFields } from './DayLogFields'

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
    /** Today's weight and note, at the bottom of the log */
    initialDayNote: string
    initialWeightKg: number | null
    /** The last weigh-in before today, the weight box's hint */
    lastWeightKg: number | null
}

// Today's log: every exercise, strength or cardio, is a table of sets whose columns come from
// its log type (lib/set-log.ts). Last time's sets show as grey hints in the empty cells. A
// logged set's numbers can be typed over where they are. An exercise folds to its name and
// summary; logging a set in another one folds the one before, so usually only the exercise in
// progress is open.
//
// kg/lb is chosen per exercise (some machines are in lb), remembered in exercise_log_units, and
// starts as the reading unit from Settings, which this card never changes. km/mi is one choice.
// Both are switched in the table's column header, where the unit is shown, so a folded
// exercise is just its name and one line.

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
    initialDayNote,
    initialWeightKg,
    lastWeightKg,
}: TodayWorkoutCardProps) {
    const t = useTranslations('today')
    const supabase = createClient()
    const router = useRouter()
    const [workoutId, setWorkoutId] = useState<string | null>(initialWorkoutId)
    const [exercises, setExercises] = useState<TodayExercise[]>(initialExercises)
    const [showAddPicker, setShowAddPicker] = useState(false)
    const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null)
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

    // A page left open overnight still holds yesterday: once the day is over, reload today when the
    // page is seen again or a minute passes. Once per day, in case this device's clock runs ahead.
    const reloadedFor = useRef<string | null>(null)
    useEffect(() => {
        const check = () => {
            if (!dayIsOver(todayRange) || reloadedFor.current === todayRange.end) return
            reloadedFor.current = todayRange.end
            router.refresh()
        }
        const onVisible = () => { if (document.visibilityState === 'visible') check() }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', check)
        const timer = setInterval(check, 60_000)
        return () => {
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('focus', check)
            clearInterval(timer)
        }
    }, [todayRange, router])

    /** A day that ended while the page was open: today is reloaded, nothing logged into yesterday */
    function newDay(err: unknown): boolean {
        if (!(err instanceof DayOverError)) return false
        setError(t('newDay'))
        router.refresh()
        return true
    }

    /** A short note above the tab bar; with undo, it stays long enough to tap it */
    function showToast(message: string, undo?: () => void) {
        if (toastTimer.current) clearTimeout(toastTimer.current)
        setToast({ message, undo })
        toastTimer.current = setTimeout(() => setToast(null), undo ? 5000 : 1800)
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
        if (saveError) {
            reportClientError('client/today/exercise-unit', saveError)
            setError(toFriendlyError(saveError, language))
        }
    }

    async function handleDistanceUnit(next: DistanceUnit) {
        setDistanceUnit(next)
        await supabase.from('user_profiles').update({ distance_unit: next }).eq('user_id', userId)
    }

    /**
     * Today's workout and its exercises, starting the workout on the first set. Starting is one
     * transaction (start_today_workout): the workout and its planned exercises, or nothing. Ronnie
     * or another tab may have started one since the page loaded; that one comes back instead, read
     * with its own planned exercises, so today's log isn't split in two.
     */
    async function ensureWorkout(): Promise<{ id: string; exercises: TodayExercise[] }> {
        if (dayIsOver(todayRange)) throw new DayOverError()
        if (workoutId) return { id: workoutId, exercises }

        try {
            await startTodayWorkout(supabase, { range: todayRange, routineId: routineIdForToday, exerciseIds: exercises.map((ex) => ex.exerciseId) })
        } catch (err) {
            // The user sees the friendly message; the report gets what failed, its cause
            if (err instanceof DayOverError) throw err
            throw new Error(toFriendlyError((err as { cause?: { message: string; code?: string } }).cause ?? null, language), { cause: err })
        }
        const today = await loadTodayWorkout(supabase, { userId, range: todayRange, routineId: routineIdForToday, language })
        if (!today.workoutId) throw new Error("Today's workout was started but could not be read")
        setWorkoutId(today.workoutId)
        setExercises(today.exercises)
        return { id: today.workoutId, exercises: today.exercises }
    }

    /** Adds the exercise to today's workout; returns the list with it */
    async function planExercise(wId: string, current: TodayExercise[], exercise: Omit<TodayExercise, 'plannedRowId' | 'loggedSets'>): Promise<TodayExercise[]> {
        const { data, error: insertError } = await supabase
            .from('workout_planned_exercises')
            .insert({ workout_id: wId, exercise_id: exercise.exerciseId, user_id: userId })
            .select('id')
            .single()
        if (insertError || !data) throw new Error(toFriendlyError(insertError, language), { cause: insertError })
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
                throw new Error(toFriendlyError(insertError, language), { cause: insertError })
            }

            // On the list as it is now, so a set changed or deleted during the save stays that way;
            // an exercise planned just now is only on the list that planned it
            setExercises((prev) => (prev.some((ex) => ex.exerciseId === exerciseId) ? prev : current).map((ex) =>
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
            if (newDay(err)) return false
            reportClientError('client/today/save-set', err)
            setError(err instanceof Error ? err.message : 'Something went wrong.')
            return false
        }
    }

    /** A logged set typed over: shown at once, and put back if it can't be saved */
    async function handleUpdateSet(exerciseId: string, setId: string, values: SetValues) {
        setError(null)
        const before = exercises.find((ex) => ex.exerciseId === exerciseId)?.loggedSets.find((s) => s.id === setId)
        const show = (v: SetValues) => setExercises((prev) =>
            prev.map((ex) =>
                ex.exerciseId !== exerciseId
                    ? ex
                    : { ...ex, loggedSets: ex.loggedSets.map((s) => (s.id === setId ? { ...s, ...v } : s)) }
            )
        )
        show(values)
        const { error: updateError } = await supabase.from('workout_sets').update(toSetRow(values)).eq('id', setId)
        if (updateError) {
            reportClientError('client/today/update-set', updateError)
            if (before) show(before)
            setError(toFriendlyError(updateError, language))
        }
    }

    // Deleted at once, with a few seconds to undo it: the × is one tap, and a set is real work.
    // Undo logs it again as it was, under its own number.
    async function handleDeleteSet(exerciseId: string, setId: string) {
        setError(null)
        const deleted = exercises.find((ex) => ex.exerciseId === exerciseId)?.loggedSets.find((s) => s.id === setId)
        const { error: deleteError } = await supabase.from('workout_sets').delete().eq('id', setId)
        if (deleteError) {
            reportClientError('client/today/delete-set', deleteError)
            setError(toFriendlyError(deleteError, language))
            return
        }
        setExercises((prev) =>
            prev.map((ex) =>
                ex.exerciseId !== exerciseId
                    ? ex
                    : { ...ex, loggedSets: ex.loggedSets.filter((s) => s.id !== setId) }
            )
        )
        if (!deleted || !workoutId) return
        showToast(t('setDeleted', { n: deleted.setNumber }), async () => {
            setToast(null)
            const { data, error: insertError } = await supabase
                .from('workout_sets')
                .insert({ workout_id: workoutId, exercise_id: exerciseId, user_id: userId, set_number: deleted.setNumber, ...toSetRow(deleted) })
                .select('id, created_at')
                .single()
            if (insertError || !data) {
                reportClientError('client/today/undo-delete-set', insertError)
                setError(toFriendlyError(insertError, language))
                return
            }
            setExercises((prev) => prev.map((ex) => ex.exerciseId !== exerciseId ? ex : {
                ...ex,
                loggedSets: [...ex.loggedSets, { ...deleted, id: data.id, createdAt: data.created_at }].sort((a, b) => a.setNumber - b.setNumber),
            }))
        })
    }

    async function handleRemoveExercise(exerciseId: string) {
        setError(null)
        // Its logged sets go with it, once the user says so: kept, they'd be counted in History and
        // the report while the card showed nothing
        const logged = exercises.find((ex) => ex.exerciseId === exerciseId)?.loggedSets.length ?? 0
        if (logged > 0 && !confirm(t('removeWithSets', { count: logged }))) return
        try {
            const { id: wId, exercises: current } = await ensureWorkout()
            const exercise = current.find((ex) => ex.exerciseId === exerciseId)
            if (!exercise) return
            if (exercise.loggedSets.length > 0) {
                const { error: setsError } = await supabase.from('workout_sets').delete().eq('workout_id', wId).eq('exercise_id', exerciseId)
                if (setsError) throw new Error(toFriendlyError(setsError, language), { cause: setsError })
            }
            if (exercise.plannedRowId) {
                const { error: deleteError } = await supabase
                    .from('workout_planned_exercises')
                    .delete()
                    .eq('id', exercise.plannedRowId)
                if (deleteError) throw new Error(toFriendlyError(deleteError, language), { cause: deleteError })
            }
            setExercises(current.filter((ex) => ex.exerciseId !== exerciseId))
        } catch (err) {
            if (newDay(err)) return
            reportClientError('client/today/remove-exercise', err)
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
                    logNote: logNoteOf(exercise),
                    logUnit: logUnits.get(exercise.id) ?? null,
                    previous: previous.get(exercise.id) ?? [],
                    // Added just for today: the routine has no target for it
                    target: null,
                }))
            }
            setOpenState((s) => ({ ...s, open: s.open.includes(exercise.id) ? s.open : [...s.open, exercise.id] }))
            setShowAddPicker(false)
        } catch (err) {
            if (newDay(err)) return
            reportClientError('client/today/add-exercise', err)
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        }
    }

    return (
        <div className="relative space-y-4 rounded-2xl border border-line bg-card p-4 md:p-5">

            {/* Header: today's routine (the page's own title already says 今天) */}
            <button
                type="button"
                onClick={() => setIsCollapsed((v) => !v)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between gap-3 text-left"
            >
                <span className="min-w-0">
                    <h2 className="truncate text-xl font-bold">{routineName ?? t('title')}</h2>
                    {hasCycle && (
                        <span className="text-[13px] text-muted">{t('dayOf', { day: dayIndex, total: cycleLength })}</span>
                    )}
                </span>
                <span className="grid size-11 shrink-0 place-items-center text-faint">
                    <Chevron closed={isCollapsed} size={18} />
                </span>
            </button>

            {/* Folded away, not unmounted: what was being typed is still there when it opens again */}
            <div className={isCollapsed ? 'hidden' : 'space-y-4'}>
                    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

                    {hasCycle && isRestDay && exercises.length === 0 && (
                        <p className="text-sm text-ink/60">{t('restDay')}</p>
                    )}
                    {hasCycle && !isRestDay && exercises.length === 0 && (
                        <p className="text-sm text-ink/60">{t('emptyRoutine')}</p>
                    )}
                    {/* Nothing planned: Coach G can plan the routines and the cycle */}
                    {!hasCycle && exercises.length === 0 && (
                        <div>
                            <p className="text-sm text-ink/60">{t('emptyFree')}</p>
                            <Link href="/routines?coachG=1" className="inline-flex min-h-11 items-center text-sm font-bold text-accent md:min-h-9">
                                {t('coachGLink')} →
                            </Link>
                        </div>
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
                                onDistanceUnitChange={handleDistanceUnit}
                                onAddSet={handleAddSet}
                                onUpdateSet={handleUpdateSet}
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
                            className="h-11 w-full rounded-lg border border-dashed border-line text-[15px] text-muted hover:border-ink/30 hover:text-ink"
                        >
                            {t('addExercise')}
                        </button>
                    )}

                    <DayLogFields
                        initialWeightKg={initialWeightKg}
                        lastWeightKg={lastWeightKg}
                        initialNote={initialDayNote}
                        weightUnit={readingUnit}
                    />
            </div>

            {toast && (
                // Above the phone's tab bar
                <div role="status" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md bg-plate px-4 py-2 text-sm text-chalk shadow-lg md:bottom-6">
                    <span>{toast.message}</span>
                    {toast.undo && (
                        <button type="button" onClick={toast.undo} className="-my-2 min-h-11 px-2 font-bold text-accent md:min-h-9">
                            {t('undo')}
                        </button>
                    )}
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

interface AddExercisePanelProps {
    exercises: ExerciseOption[]
    language: string
    onAdd: (exercise: ExerciseOption) => Promise<void>
    onCancel: () => void
}

function AddExercisePanel({ exercises, language, onAdd, onCancel }: AddExercisePanelProps) {
    const t = useTranslations('today')
    const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? '')
    // One add at a time: a second tap while the first saves would add it twice
    const [adding, setAdding] = useState(false)

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
                    disabled={!selectedId || adding}
                    onClick={async () => {
                        const exercise = exercises.find((ex) => ex.id === selectedId)
                        if (!exercise || adding) return
                        setAdding(true)
                        try { await onAdd(exercise) } finally { setAdding(false) }
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
    onDistanceUnitChange: (unit: DistanceUnit) => void
    onAddSet: (exerciseId: string, values: SetValues) => Promise<boolean>
    onUpdateSet: (exerciseId: string, setId: string, values: SetValues) => void
    onDeleteSet: (exerciseId: string, setId: string) => void
    onRemove: (exerciseId: string) => void
}

/** One exercise: its name and one line (the target, then the sets), which fold the table away */
function ExerciseBlock({ exercise, isOpen, onToggle, language, units, onUnitChange, onDistanceUnitChange, onAddSet, onUpdateSet, onDeleteSet, onRemove }: ExerciseBlockProps) {
    const t = useTranslations('today')
    const ts = useTranslations('sets')

    return (
        <div className="grid gap-3 border-t border-line py-3 first:border-t-0 first:pt-0">
            <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex min-h-11 w-full items-center gap-2 text-left">
                <span className="text-faint"><Chevron closed={!isOpen} size={16} /></span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                        <span className="truncate text-[17px] font-bold leading-snug">{exercise.name}</span>
                        {/* The muscle group fits beside the name from md up; the phone keeps one line for it */}
                        <span className="hidden shrink-0 text-xs text-faint md:inline">{getMuscleGroupLabel(exercise.muscleGroup, language)}</span>
                    </span>
                    <span className="block text-sm text-muted empty:hidden">
                        <SummaryLine t={ts} logType={exercise.logType} sets={exercise.loggedSets} units={units} target={exercise.target} />
                    </span>
                </span>
            </button>

            {/* Folded away, not unmounted, so a set being typed waits for the exercise to open again */}
            <div className={isOpen ? 'contents' : 'hidden'}>
                    {/* Said in words where the sets are typed: one side, or one dumbbell (lib/set-log.ts logNoteOf) */}
                    {exercise.logNote && (
                        <p className="-mt-1 text-[13px] text-muted">
                            {exercise.logNote === 'per_side'
                                ? ts('note.perSide', { what: exercise.logType === 'duration' ? 'seconds' : exercise.logType === 'bodyweight' ? 'reps' : 'weight' })
                                : ts('note.oneDumbbell')}
                        </p>
                    )}
                    {/* Typed values are in the units shown, so switching units starts the row over */}
                    <SetTable
                        key={`${units.weight}-${units.distance}`}
                        exercise={exercise}
                        units={units}
                        onUnitChange={onUnitChange}
                        onDistanceUnitChange={onDistanceUnitChange}
                        onAddSet={onAddSet}
                        onUpdateSet={onUpdateSet}
                        onDeleteSet={onDeleteSet}
                    />
                    <button
                        type="button"
                        onClick={() => onRemove(exercise.exerciseId)}
                        className="-my-2 justify-self-start py-2 text-[13px] text-faint hover:text-miss active:opacity-50"
                    >
                        {t('removeExercise')}
                    </button>
            </div>
        </div>
    )
}

// A finger-sized row (44px) on the phone, a mouse-sized one (36px) from md up
const NUMBER = 'text-center font-mono text-sm font-bold text-muted'
const CELL = 'h-11 truncate rounded-lg bg-done px-1 text-center font-mono text-base font-bold leading-[44px] md:h-9 md:leading-9'
// A logged value looks like a cell until it is tapped, then like the input it was typed in. No
// border class: the dark theme restyles .border with !important (globals.css), so a ring marks a typo.
const LOGGED = 'h-11 min-h-0! w-full min-w-0 truncate rounded-lg bg-done px-1 text-center font-mono text-base font-bold focus:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-invalid:ring-2 aria-invalid:ring-inset aria-invalid:ring-miss md:h-9'
const INPUT = 'h-11 min-h-0! w-full min-w-0 rounded-lg border border-line bg-card px-1 text-center font-mono text-base font-bold placeholder:font-medium placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:h-9'
const PLUS = 'h-11 w-11 rounded-lg bg-accent text-xl leading-none text-accent-ink transition-colors disabled:bg-accent-soft disabled:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:h-9 md:w-9'
const WHOLE_NUMBERS = new Set<FieldKey>(['reps', 'seconds'])

/** The sets as a table: set number, the log type's columns, and delete or add */
function SetTable({ exercise, units, onUnitChange, onDistanceUnitChange, onAddSet, onUpdateSet, onDeleteSet }: {
    exercise: TodayExercise
    units: Units
    onUnitChange: (unit: WeightUnit) => void
    onDistanceUnitChange: (unit: DistanceUnit) => void
    onAddSet: (exerciseId: string, values: SetValues) => Promise<boolean>
    onUpdateSet: (exerciseId: string, setId: string, values: SetValues) => void
    onDeleteSet: (exerciseId: string, setId: string) => void
}) {
    const t = useTranslations('today')
    const ts = useTranslations('sets')
    const fields = LOG_FIELDS[exercise.logType]
    const [draft, setDraft] = useState<string[]>(() => fields.map(() => ''))
    const [saving, setSaving] = useState(false)
    const firstInput = useRef<HTMLInputElement>(null)
    // When the last set was added: its × takes the place where ＋ was, so a quick second tap on ＋
    // would delete the set just logged
    const addedAt = useRef(0)
    // One column template for every row, so the numbers, cells and buttons line up
    const grid = { gridTemplateColumns: `28px repeat(${fields.length}, minmax(0, 1fr)) auto` }
    const next = exercise.loggedSets.length
    // Last time's set with the same number, as hints; none if it was logged another way
    const hint = exercise.previous[next] && fitsLogType(exercise.logType, exercise.previous[next]) ? exercise.previous[next] : null
    const ready = fields.every((key, i) => isValidField(key, draft[i], units))

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!ready || saving) return
        setSaving(true)
        const saved = await onAddSet(exercise.exerciseId, toStoredSet(exercise.logType, draft.map(Number), units))
        setSaving(false)
        if (saved) {
            addedAt.current = Date.now()
            setDraft(fields.map(() => ''))
            firstInput.current?.focus()
        }
    }

    return (
        <div className="grid gap-1.5">
            <div className="mb-0.5 grid items-center gap-x-2 border-b border-line pb-1.5 text-center text-xs tracking-wide text-faint" style={grid}>
                <span>{ts('set')}</span>
                {fields.map((key) => {
                    const label = fieldLabel(ts, key, units)
                    // The unit is switched where it is shown: kg/lb for this exercise, km/mi for all
                    const switchTo = isWeightField(key)
                        ? () => onUnitChange(units.weight === 'kg' ? 'lb' : 'kg')
                        : key === 'speed'
                            ? () => onDistanceUnitChange(units.distance === 'km' ? 'mi' : 'km')
                            : null
                    if (!switchTo) return <span key={key} className="truncate">{label}</span>
                    const other = fieldLabel(ts, key, isWeightField(key)
                        ? { ...units, weight: units.weight === 'kg' ? 'lb' : 'kg' }
                        : { ...units, distance: units.distance === 'km' ? 'mi' : 'km' })
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={switchTo}
                            aria-label={t('switchTo', { unit: other })}
                            title={t('switchTo', { unit: other })}
                            className="mx-auto inline-flex min-h-8 max-w-full items-center gap-1 rounded-md border border-line px-2 font-semibold text-ink hover:border-ink/30"
                        >
                            <span className="truncate">{label}</span>
                            <span aria-hidden="true" className="text-faint">⇄</span>
                        </button>
                    )
                })}
                <span className="w-11 md:w-9" />
            </div>

            {exercise.loggedSets.map((s, i) => (
                <div key={s.id} className="grid items-center gap-x-2" style={grid}>
                    <span className={NUMBER}>{i + 1}</span>
                    {fitsLogType(exercise.logType, s)
                        ? fields.map((key) => (
                            <LoggedCell
                                key={key}
                                field={key}
                                set={s}
                                units={units}
                                label={ts('fieldOfSet', { n: i + 1, field: fieldLabel(ts, key, units) })}
                                // In the kg/lb the set was typed in, so 80 lb stays 80 lb
                                onSave={(typed) => onUpdateSet(exercise.exerciseId, s.id, withField(s, key, typed, unitsOfSet(s, units)))}
                            />
                        ))
                        // Logged before this exercise had its columns: shown the way it was logged
                        : <span className={`${CELL} text-ink/60`} style={{ gridColumn: `span ${fields.length}` }}>{compactSet(ts, 'weight_reps', s, units)}</span>}
                    <button
                        type="button"
                        onClick={() => {
                            if (i === exercise.loggedSets.length - 1 && Date.now() - addedAt.current < 700) return
                            onDeleteSet(exercise.exerciseId, s.id)
                        }}
                        aria-label={ts('deleteSet', { n: i + 1 })}
                        className="h-11 w-11 text-lg text-faint hover:text-miss active:opacity-50 md:h-9 md:w-9"
                    >
                        ×
                    </button>
                </div>
            ))}

            <form onSubmit={handleSubmit} className="grid items-center gap-x-2" style={grid}>
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

/**
 * One value of a logged set. It reads like the other cells (BW, +10, 80 lb); tapped, it is the
 * plain number, selected so typing replaces it. Leaving it or Enter saves a valid change;
 * Escape or an invalid value puts the number back.
 */
function LoggedCell({ field, set, units, label, onSave }: {
    field: FieldKey
    set: SetValues
    units: Units
    label: string
    onSave: (typed: number) => void
}) {
    const ts = useTranslations('sets')
    const typedAs = String(fieldValue(field, set, unitsOfSet(set, units)) ?? '')
    // What is being typed; null while the cell isn't being edited
    const [draft, setDraft] = useState<string | null>(null)
    const cancelled = useRef(false)

    function finish() {
        if (!cancelled.current && draft != null && draft.trim() !== typedAs && isValidField(field, draft, unitsOfSet(set, units))) onSave(Number(draft))
        cancelled.current = false
        setDraft(null)
    }

    return (
        <input
            type="text"
            inputMode={WHOLE_NUMBERS.has(field) ? 'numeric' : 'decimal'}
            value={draft ?? cellText(ts, field, set, units)}
            onFocus={(e) => {
                setDraft(typedAs)
                const input = e.currentTarget
                // After React puts the plain number in
                requestAnimationFrame(() => input.select())
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                    cancelled.current = true
                    e.currentTarget.blur()
                }
            }}
            aria-label={label}
            aria-invalid={draft != null && !isValidField(field, draft, unitsOfSet(set, units))}
            data-logged=""
            className={LOGGED}
        />
    )
}
