'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { MuscleGroupExercisePicker } from './MuscleGroupExercisePicker'
import { CycleScheduler, type CycleDayState } from './CycleScheduler'
import { CoachGEntry } from './CoachGEntry'
import { Icon } from './Icon'
import { MoreMenu } from './MoreMenu'
import { toFriendlyError } from '@/lib/friendly-error'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { closeSubPage, openSubPage } from '@/lib/sub-page'
import { isSubmitEnter } from '@/lib/keyboard'
import type { ExerciseOption } from './log-types'
import type { RoutineWithExercises, RoutineExerciseRow } from '@/app/(app)/routines/page'

// The 課表 page. Side by side (@split): the training cycle as one strip on top, then the
// routines on the left and the chosen routine's editor on the right. On a phone: a
// 循環 / 課表 switch, the list of routines, and a routine opens as a page of its own
// (?routine=, see lib/sub-page.ts) that the top bar's back button closes.

interface RoutineBuilderProps {
    userId: string
    exercises: ExerciseOption[]
    initialRoutines: RoutineWithExercises[]
    language: string
    initialCycle: { id: string; cycleLength: number; startDate: string } | null
    initialCycleDays: CycleDayState[]
    /** Today in the user's time zone, YYYY-MM-DD */
    today: string
    trainingGoal: string | null
}

interface RawRoutineExercise {
    id: string
    exercise_id: string
    order_index: number
    target_sets: number | null
    target_reps: number | null
    exercises: { name: string; muscle_group: string } | null
}

// Phone sizes first (44px targets, 15px text), the denser desktop ones from md
const CARD = 'rounded-[14px] border border-line bg-card p-4'
const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-[9px] border border-line bg-card px-4 text-[15px] font-bold transition-colors hover:bg-done disabled:opacity-50 md:min-h-9 md:px-3 md:text-[13px]'
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-[9px] bg-accent px-4 text-[15px] font-bold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50 md:min-h-9 md:px-3 md:text-[13px]'
const NUMBER_INPUT = 'h-11 w-14 rounded-[7px] border border-line bg-card px-1 text-center font-mono font-bold md:h-auto md:w-12'

const isShown = (ex: RoutineExerciseRow) => ex.exercise_name !== 'Unknown exercise' && ex.exercise_name !== ''

export function RoutineBuilder({
    userId,
    exercises,
    initialRoutines,
    language,
    initialCycle,
    initialCycleDays,
    today,
    trainingGoal,
}: RoutineBuilderProps) {
    const supabase = createClient()
    const t = useTranslations('routines')
    const zh = language === 'zh-TW'
    const searchParams = useSearchParams()
    const [routines, setRoutines] = useState<RoutineWithExercises[]>(initialRoutines)
    const [days, setDays] = useState<CycleDayState[]>(() =>
        initialCycleDays.length > 0
            ? initialCycleDays
            : Array.from({ length: initialCycle?.cycleLength ?? 0 }, (_, i) => ({ dayIndex: i + 1, routineId: null }))
    )
    // The phone's 循環 / 課表 switch
    const [view, setView] = useState<'routines' | 'cycle'>('routines')
    const [isCreating, setIsCreating] = useState(false)
    const [newRoutineName, setNewRoutineName] = useState('')
    const [error, setError] = useState<string | null>(null)

    const opened = routines.find((r) => r.id === searchParams.get('routine')) ?? null
    // Side by side, the editor shows the first routine until another is picked
    const shown = opened ?? routines[0] ?? null
    const daysOf = (routineId: string) => days.filter((d) => d.routineId === routineId).map((d) => d.dayIndex)

    const loadRoutines = useCallback(async () => {
        const { data } = await createClient()
            .from('routines')
            .select(`
                id, name,
                routine_exercises (
                    id, exercise_id, order_index, target_sets, target_reps,
                    exercises ( name, muscle_group )
                )
            `)
            .eq('user_id', userId)
            .order('created_at')

        if (data) {
            setRoutines(data.map((r) => ({
                id: r.id,
                name: r.name,
                exercises: ((r.routine_exercises ?? []) as RawRoutineExercise[])
                    .map((re) => ({
                        id: re.id,
                        exercise_id: re.exercise_id,
                        exercise_name: re.exercises?.name ?? 'Unknown exercise',
                        muscle_group: re.exercises?.muscle_group ?? 'other',
                        order_index: re.order_index,
                        target_sets: re.target_sets,
                        target_reps: re.target_reps,
                    }))
                    .sort((a, b) => a.order_index - b.order_index),
            })))
        }
    }, [userId])

    // Ronnie can change a routine from the chat
    useEffect(() => {
        window.addEventListener('ronnie-routine-changed', loadRoutines)
        return () => window.removeEventListener('ronnie-routine-changed', loadRoutines)
    }, [loadRoutines])

    const updateRoutine = (routineId: string, update: (r: RoutineWithExercises) => RoutineWithExercises) =>
        setRoutines((prev) => prev.map((r) => (r.id === routineId ? update(r) : r)))

    function startCreating() {
        setError(null)
        setView('routines')
        setIsCreating(true)
    }

    async function handleCreateRoutine(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        const trimmedName = newRoutineName.trim()
        if (!trimmedName) return

        const isDuplicate = routines.some(
            (r) => r.name.trim().toLowerCase() === trimmedName.toLowerCase()
        )
        if (isDuplicate) {
            setError(zh ? `你已經有一個叫「${trimmedName}」的課表了。` : `You already have a routine named "${trimmedName}".`)
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
        setIsCreating(false)
        openSubPage('routine', data.id)
    }

    async function handleDeleteRoutine(routine: RoutineWithExercises) {
        if (!confirm(t('deleteRoutineConfirm', { name: routine.name }))) return
        setError(null)

        await supabase.from('cycle_days').update({ routine_id: null }).eq('routine_id', routine.id)
        await supabase.from('workouts').update({ routine_id: null }).eq('routine_id', routine.id)

        const { error: deleteError } = await supabase.from('routines').delete().eq('id', routine.id)
        if (deleteError) { setError(toFriendlyError(deleteError, language)); return }

        setRoutines((prev) => prev.filter((r) => r.id !== routine.id))
        setDays((prev) => prev.map((d) => (d.routineId === routine.id ? { ...d, routineId: null } : d)))
        if (searchParams.has('routine')) closeSubPage('routine')
    }

    async function handleRenameRoutine(routineId: string, newName: string) {
        setError(null)
        const trimmedName = newName.trim()
        if (!trimmedName) return

        const isDuplicate = routines.some(
            (r) => r.id !== routineId && r.name.trim().toLowerCase() === trimmedName.toLowerCase()
        )
        if (isDuplicate) {
            setError(zh ? `你已經有一個叫「${trimmedName}」的課表了。` : `You already have a routine named "${trimmedName}".`)
            return
        }

        const { error: updateError } = await supabase
            .from('routines').update({ name: trimmedName }).eq('id', routineId)

        if (updateError) { setError(toFriendlyError(updateError, language)); return }

        updateRoutine(routineId, (r) => ({ ...r, name: trimmedName }))
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

        const nextOrderIndex = routine.exercises.length > 0
            ? Math.max(...routine.exercises.map((ex) => ex.order_index)) + 1
            : 0

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
            setError(toFriendlyError(insertError, language))
            return
        }

        updateRoutine(routineId, (r) => ({
            ...r,
            exercises: [...r.exercises, {
                id: data.id,
                exercise_id: data.exercise_id,
                exercise_name: exercise.name,
                muscle_group: exercise.muscle_group,
                order_index: data.order_index,
                target_sets: data.target_sets,
                target_reps: data.target_reps,
            }],
        }))
    }

    async function handleRemoveExercise(routineId: string, routineExerciseId: string) {
        setError(null)
        const { error: deleteError } = await supabase
            .from('routine_exercises').delete().eq('id', routineExerciseId)
        if (deleteError) { setError(toFriendlyError(deleteError, language)); return }
        updateRoutine(routineId, (r) => ({ ...r, exercises: r.exercises.filter((ex) => ex.id !== routineExerciseId) }))
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
        updateRoutine(routineId, (r) => ({
            ...r,
            exercises: r.exercises.map((ex) =>
                ex.id !== routineExerciseId ? ex : { ...ex, target_sets: targetSets, target_reps: targetReps }
            ),
        }))
    }

    // The new order is shown at once and saved as order_index 0, 1, 2…; the first exercise
    // is one of the report's main lifts. If a save fails, the routine reloads as stored.
    async function handleReorder(routineId: string, orderedIds: string[]) {
        const routine = routines.find((r) => r.id === routineId)
        if (!routine) return
        setError(null)
        const byId = new Map(routine.exercises.map((ex) => [ex.id, ex]))
        const rest = routine.exercises.filter((ex) => !orderedIds.includes(ex.id))
        const before = [...orderedIds.flatMap((id) => byId.get(id) ?? []), ...rest]
        const reordered = before.map((ex, i) => ({ ...ex, order_index: i }))
        updateRoutine(routineId, (r) => ({ ...r, exercises: reordered }))

        const results = await Promise.all(reordered
            .filter((ex, i) => ex.order_index !== before[i].order_index)
            .map((ex) => supabase.from('routine_exercises').update({ order_index: ex.order_index }).eq('id', ex.id)))
        const failed = results.find((r) => r.error)
        if (failed) {
            setError(toFriendlyError(failed.error, language))
            await loadRoutines()
        }
    }

    const coachG = (variant: 'button' | 'card') => (
        <CoachGEntry
            variant={variant}
            hasRoutines={routines.length > 0}
            routineCount={routines.length}
            language={language}
            trainingGoal={trainingGoal}
        />
    )

    return (
        <div className="space-y-5 md:space-y-4">
            {/* On a phone the top bar has the title and nothing else here shows, so the row takes no space */}
            <div className="flex items-end justify-between gap-4 max-md:contents">
                <h1 className="text-2xl font-bold max-md:sr-only">{t('title')}</h1>
                <div className="ml-auto hidden items-center gap-2 @split:flex">
                    {routines.length > 0 && coachG('button')}
                    <button type="button" onClick={startCreating} className={PRIMARY}>
                        <Icon name="plus" className="size-4" />
                        {t('newRoutine')}
                    </button>
                </div>
            </div>

            {error && <p role="alert" className="text-sm text-miss">{error}</p>}

            {/* Phone: 循環 or 課表, one at a time */}
            {!opened && (
                <div className="flex items-center justify-between gap-3 @split:hidden">
                    <div role="tablist" aria-label={t('title')} className="inline-flex overflow-hidden rounded-[9px] border border-line bg-card">
                        {(['cycle', 'routines'] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                role="tab"
                                aria-selected={view === v}
                                onClick={() => setView(v)}
                                className={`min-h-11 px-5 text-[15px] font-medium ${view === v ? 'bg-ink text-card' : 'text-muted'}`}
                            >
                                {v === 'cycle' ? t('cycleTab') : t('routinesTab')}
                            </button>
                        ))}
                    </div>
                    {view === 'routines' && (
                        <button type="button" onClick={startCreating} className={PRIMARY}>
                            <Icon name="plus" className="size-4" />
                            {t('newRoutineShort')}
                        </button>
                    )}
                </div>
            )}

            <div className={`${view === 'cycle' && !opened ? '' : 'hidden'} @split:block`}>
                <CycleScheduler
                    userId={userId}
                    routines={routines.map((r) => ({ id: r.id, name: r.name }))}
                    initialCycle={initialCycle}
                    days={days}
                    setDays={setDays}
                    today={today}
                    language={language}
                />
            </div>

            <div className={`${view === 'routines' || opened ? '' : 'hidden'} items-start gap-4 @split:grid @split:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]`}>

                {/* The routines */}
                <div className={`space-y-5 md:space-y-3 ${opened ? 'hidden @split:block' : ''}`}>
                    <section className="space-y-1 rounded-[14px] border border-line bg-card px-4 py-1 @split:p-4">
                        <h2 className="hidden pb-1 text-[15px] font-bold tracking-wide @split:block">{t('yourRoutines')}</h2>

                        {isCreating && (
                            <form onSubmit={handleCreateRoutine} className="flex flex-wrap gap-2 py-3 md:py-2">
                                <input
                                    type="text"
                                    autoFocus
                                    value={newRoutineName}
                                    onChange={(e) => setNewRoutineName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Escape') setIsCreating(false) }}
                                    placeholder={t('newRoutinePlaceholder')}
                                    aria-label={t('newRoutine')}
                                    className="h-11 min-w-0 flex-1 rounded-[9px] border border-line bg-card px-3 text-base md:h-auto md:py-2 md:text-sm"
                                />
                                <div className="flex gap-2">
                                    <button type="submit" className={PRIMARY}>{t('create')}</button>
                                    <button type="button" onClick={() => setIsCreating(false)} className={BUTTON}>{t('cancel')}</button>
                                </div>
                            </form>
                        )}

                        {routines.length === 0 && !isCreating && (
                            <p className="py-3 text-[15px] text-muted md:py-2 md:text-sm">{t('noRoutines')}</p>
                        )}

                        <ul className="divide-y divide-line">
                            {routines.map((routine) => {
                                const visible = routine.exercises.filter(isShown)
                                const totalSets = visible.reduce((sum, ex) => sum + (ex.target_sets ?? 0), 0)
                                const dayIndexes = daysOf(routine.id)
                                const meta = [
                                    t('exerciseCount', { count: visible.length }),
                                    t('setCount', { count: totalSets }),
                                    ...(dayIndexes.length ? [t('onDays', { days: dayIndexes.join(zh ? '、' : ', ') })] : []),
                                ].join(t('separator'))
                                return (
                                    <li key={routine.id}>
                                        <button
                                            type="button"
                                            onClick={() => openSubPage('routine', routine.id)}
                                            aria-current={routine.id === shown?.id ? 'true' : undefined}
                                            className={`-mx-2 grid min-h-16 w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-2 gap-y-0.5 rounded-[10px] px-2 py-2.5 text-left md:min-h-0 md:gap-y-0 ${routine.id === shown?.id ? '@split:bg-accent-soft' : 'hover:bg-done'}`}
                                        >
                                            <span className="truncate font-bold">{routine.name}</span>
                                            <Icon name="forward" className="row-span-2 size-4 text-faint" />
                                            <span className="truncate text-[13px] text-muted md:text-xs">{meta}</span>
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>

                    {/* Coach G: the big invitation while there are no routines; on a phone, below the list */}
                    {routines.length === 0 ? coachG('card') : <div className="@split:hidden">{coachG('card')}</div>}
                </div>

                {/* The chosen routine */}
                <div className={opened ? '' : 'hidden @split:block'}>
                    {shown ? (
                        <RoutineEditor
                            key={shown.id}
                            routine={shown}
                            dayIndexes={daysOf(shown.id)}
                            exercises={exercises}
                            language={language}
                            onRename={(name) => handleRenameRoutine(shown.id, name)}
                            onDelete={() => handleDeleteRoutine(shown)}
                            onAdd={(exercise, sets, reps) => handleAddExercise(shown.id, exercise, sets, reps)}
                            onRemove={(id) => handleRemoveExercise(shown.id, id)}
                            onUpdateTarget={(id, sets, reps) => handleUpdateTarget(shown.id, id, sets, reps)}
                            onReorder={(ids) => handleReorder(shown.id, ids)}
                        />
                    ) : (
                        <div className={`${CARD} hidden py-10 text-center text-[15px] text-muted @split:block md:text-sm`}>
                            {t('pickOrCreate')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

interface RoutineEditorProps {
    routine: RoutineWithExercises
    dayIndexes: number[]
    exercises: ExerciseOption[]
    language: string
    onRename: (name: string) => void
    onDelete: () => void
    onAdd: (exercise: ExerciseOption, targetSets: number, targetReps: number) => void
    onRemove: (routineExerciseId: string) => void
    onUpdateTarget: (routineExerciseId: string, targetSets: number, targetReps: number) => void
    onReorder: (orderedIds: string[]) => void
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next
}

/**
 * One routine: its name, its exercises with sets × reps, and adding, renaming and deleting.
 * The order changes by dragging a row's ⋮⋮ handle (mouse or finger), or with the arrow keys
 * on the handle.
 */
function RoutineEditor({
    routine,
    dayIndexes,
    exercises,
    language,
    onRename,
    onDelete,
    onAdd,
    onRemove,
    onUpdateTarget,
    onReorder,
}: RoutineEditorProps) {
    const t = useTranslations('routines')
    const zh = language === 'zh-TW'
    const [renaming, setRenaming] = useState(false)
    const [name, setName] = useState(routine.name)
    const [adding, setAdding] = useState(false)
    // While a row is being dragged: which one, and the order on screen
    const [dragging, setDragging] = useState<{ id: string; order: string[] } | null>(null)
    const drag = useRef<{ pointerId: number; id: string; from: number; mids: number[]; order: string[] } | null>(null)
    const listRef = useRef<HTMLOListElement>(null)

    const visible = routine.exercises.filter(isShown)
    const byId = new Map(visible.map((ex) => [ex.id, ex]))
    const rows = dragging ? dragging.order.flatMap((id) => byId.get(id) ?? []) : visible

    function startRenaming() {
        setName(routine.name)
        setRenaming(true)
    }

    function commitRename() {
        if (name.trim() && name.trim() !== routine.name) onRename(name.trim())
        else setName(routine.name)
        setRenaming(false)
    }

    function handleGripDown(e: ReactPointerEvent<HTMLButtonElement>, index: number) {
        if (e.button !== 0 || !listRef.current) return
        e.preventDefault()
        // Each row's middle, where it was when the drag began
        const mids = Array.from(listRef.current.children).map((row) => {
            const rect = row.getBoundingClientRect()
            return rect.top + rect.height / 2
        })
        const order = visible.map((ex) => ex.id)
        drag.current = { pointerId: e.pointerId, id: order[index], from: index, mids, order }
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging({ id: order[index], order })
    }

    function handleGripMove(e: ReactPointerEvent<HTMLButtonElement>) {
        const d = drag.current
        if (!d || d.pointerId !== e.pointerId) return
        // The row goes past every row whose middle the pointer has crossed
        let to = d.from
        d.mids.forEach((mid, i) => {
            if (i > d.from && e.clientY > mid) to = i
            if (i < d.from && e.clientY < mid && i < to) to = i
        })
        const order = moveItem(visible.map((ex) => ex.id), d.from, to)
        if (order.join() !== d.order.join()) {
            d.order = order
            setDragging({ id: d.id, order })
        }
    }

    function handleGripUp(e: ReactPointerEvent<HTMLButtonElement>) {
        const d = drag.current
        if (!d || d.pointerId !== e.pointerId) return
        drag.current = null
        setDragging(null)
        if (d.order.join() !== visible.map((ex) => ex.id).join()) onReorder(d.order)
    }

    function handleGripCancel() {
        drag.current = null
        setDragging(null)
    }

    function handleGripKey(e: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
        const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null
        if (to === null) return
        e.preventDefault()
        if (to < 0 || to >= visible.length) return
        onReorder(moveItem(visible.map((ex) => ex.id), index, to))
    }

    return (
        <section className={`${CARD} space-y-3`}>
            {/* Back to the list when the page is too narrow for both and there is no phone top bar */}
            <button
                type="button"
                onClick={() => closeSubPage('routine')}
                className="hidden min-h-9 items-center gap-0.5 text-sm font-medium text-accent md:@max-split:flex"
            >
                <Icon name="back" className="size-4" />
                {t('title')}
            </button>

            <div className="flex items-start justify-between gap-3 md:flex-wrap">
                <div className="min-w-0 flex-1">
                    {dayIndexes.length > 0 && (
                        <p className="text-[13px] tracking-wider text-faint md:text-xs">{t('onDays', { days: dayIndexes.join(zh ? '、' : ', ') })}</p>
                    )}
                    {renaming ? (
                        <input
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                                if (isSubmitEnter(e)) commitRename()
                                if (e.key === 'Escape') { setName(routine.name); setRenaming(false) }
                            }}
                            aria-label={t('rename')}
                            className="h-11 w-full max-w-xs rounded-[9px] border border-line bg-card px-2 text-lg font-bold md:h-auto md:py-1"
                        />
                    ) : (
                        <h2 className="truncate text-xl font-bold">{routine.name}</h2>
                    )}
                </div>
                <div className="hidden gap-2 md:flex">
                    <button type="button" onClick={startRenaming} className={BUTTON}>{t('rename')}</button>
                    <button type="button" onClick={onDelete} className={`${BUTTON} hover:text-miss`}>{t('delete')}</button>
                </div>
                <MoreMenu
                    label={t('routineActions', { name: routine.name })}
                    className="-mr-2 -mt-1 md:hidden"
                    items={[
                        { label: t('rename'), onSelect: startRenaming },
                        { label: t('delete'), onSelect: onDelete, danger: true },
                    ]}
                />
            </div>

            {rows.length === 0 ? (
                <p className="py-2 text-[15px] text-muted md:text-sm">{t('emptyRoutine')}</p>
            ) : (
                <>
                    <p className="hidden text-right text-[11px] text-faint md:block" aria-hidden="true">{t('setsByReps')}</p>
                    <ol ref={listRef} className="divide-y divide-line">
                        {rows.map((ex, index) => (
                            <ExerciseRow
                                key={ex.id}
                                exercise={ex}
                                language={language}
                                exercises={exercises}
                                dragging={dragging?.id === ex.id}
                                gripProps={{
                                    onPointerDown: (e) => handleGripDown(e, index),
                                    onPointerMove: handleGripMove,
                                    onPointerUp: handleGripUp,
                                    onPointerCancel: handleGripCancel,
                                    onKeyDown: (e) => handleGripKey(e, index),
                                }}
                                onUpdateTarget={(sets, reps) => onUpdateTarget(ex.id, sets, reps)}
                                onRemove={() => onRemove(ex.id)}
                            />
                        ))}
                    </ol>
                </>
            )}

            {adding ? (
                <AddExerciseToRoutine
                    exercises={exercises}
                    language={language}
                    onAdd={onAdd}
                    onDone={() => setAdding(false)}
                />
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
                    <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
                        <Icon name="plus" className="size-4" />
                        {t('addExercise')}
                    </button>
                    {rows.length > 1 && <span className="text-[13px] text-faint md:text-xs">{t('reorderHint')}</span>}
                </div>
            )}
        </section>
    )
}

interface ExerciseRowProps {
    exercise: RoutineExerciseRow
    language: string
    exercises: ExerciseOption[]
    dragging: boolean
    gripProps: {
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
        onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void
        onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => void
        onPointerCancel: () => void
        onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
    }
    onUpdateTarget: (targetSets: number, targetReps: number) => void
    onRemove: () => void
}

function ExerciseRow({ exercise, language, exercises, dragging, gripProps, onUpdateTarget, onRemove }: ExerciseRowProps) {
    const t = useTranslations('routines')
    const [targetSets, setTargetSets] = useState(String(exercise.target_sets ?? ''))
    const [targetReps, setTargetReps] = useState(String(exercise.target_reps ?? ''))
    // On a phone the row is one tap target; it opens to show the inputs and 移除
    const [expanded, setExpanded] = useState(false)

    const displayName = (() => {
        if (language !== 'zh-TW') return exercise.exercise_name
        const found = exercises.find((ex) => ex.id === exercise.exercise_id)
        return found?.name_zh_tw ? found.name_zh_tw : exercise.exercise_name
    })()
    const muscle = getMuscleGroupLabel(exercise.muscle_group, language)

    function commitIfChanged() {
        const setsNum = Number(targetSets)
        const repsNum = Number(targetReps)
        if (!setsNum || !repsNum || setsNum <= 0 || repsNum <= 0) return
        if (setsNum !== exercise.target_sets || repsNum !== exercise.target_reps) {
            onUpdateTarget(setsNum, repsNum)
        }
    }

    const input = (value: string, set: (v: string) => void, label: string) => (
        <input
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => set(e.target.value)}
            onBlur={commitIfChanged}
            aria-label={`${displayName} ${label}`}
            className={NUMBER_INPUT}
        />
    )

    return (
        <li className={dragging ? 'rounded-[10px] bg-accent-soft' : ''}>
            <div className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2 md:grid-cols-[28px_minmax(0,1fr)_auto_32px] md:py-2">
                <button
                    type="button"
                    {...gripProps}
                    aria-label={t('moveExercise', { name: displayName })}
                    className="flex h-11 cursor-grab touch-none items-center justify-center rounded-[7px] text-faint hover:text-ink active:cursor-grabbing md:h-10"
                >
                    <Icon name="grip" className="size-5" />
                </button>

                {/* Phone: name and sets × reps; a tap opens the inputs */}
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="flex min-h-[60px] min-w-0 items-center gap-3 py-2 text-left md:hidden"
                >
                    <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{displayName}</span>
                        <span className="text-[13px] text-muted">{muscle}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[15px] font-bold">{targetSets || '–'} × {targetReps || '–'}</span>
                    <Icon name="forward" className={`size-4 text-faint transition-transform ${expanded ? 'rotate-90' : ''}`} />
                </button>

                {/* From md: everything in the row */}
                <span className="hidden min-w-0 md:block">
                    <span className="block truncate font-bold">{displayName}</span>
                    <span className="inline-block rounded-full bg-done px-2 text-xs text-muted">{muscle}</span>
                </span>
                <span className="hidden items-center gap-1 md:flex">
                    {input(targetSets, setTargetSets, t('sets'))}
                    <span className="text-faint">×</span>
                    {input(targetReps, setTargetReps, t('reps'))}
                </span>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t('removeExercise', { name: displayName })}
                    className="hidden size-8 items-center justify-center rounded-[7px] text-faint hover:bg-done hover:text-miss md:flex"
                >
                    <Icon name="close" className="size-4" />
                </button>
            </div>

            {expanded && (
                <div className="flex flex-wrap items-end gap-3 pb-4 pl-10 md:hidden">
                    <label className="flex flex-col gap-1">
                        <span className="text-[13px] text-muted">{t('sets')}</span>
                        {input(targetSets, setTargetSets, t('sets'))}
                    </label>
                    <span className="mb-3 text-faint">×</span>
                    <label className="flex flex-col gap-1">
                        <span className="text-[13px] text-muted">{t('reps')}</span>
                        {input(targetReps, setTargetReps, t('reps'))}
                    </label>
                    <button type="button" onClick={onRemove} className="ml-auto min-h-11 px-2 text-[15px] font-medium text-miss">
                        {t('removeShort')}
                    </button>
                </div>
            )}
        </li>
    )
}

interface AddExerciseToRoutineProps {
    exercises: ExerciseOption[]
    language: string
    onAdd: (exercise: ExerciseOption, targetSets: number, targetReps: number) => void
    onDone: () => void
}

function AddExerciseToRoutine({ exercises, language, onAdd, onDone }: AddExerciseToRoutineProps) {
    const t = useTranslations('routines')
    const [selectedId, setSelectedId] = useState(exercises[0]?.id ?? '')
    const [targetSets, setTargetSets] = useState('3')
    const [targetReps, setTargetReps] = useState('10')

    return (
        <div className="space-y-3 border-t border-line pt-4 md:space-y-2 md:pt-3 [&_select]:h-11 [&_select]:text-base md:[&_select]:h-auto md:[&_select]:text-sm">
            <MuscleGroupExercisePicker
                exercises={exercises}
                value={selectedId}
                onChange={setSelectedId}
                language={language}
            />
            <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[13px] text-muted md:text-xs">{t('sets')}</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={targetSets}
                        onChange={(e) => setTargetSets(e.target.value)}
                        className={NUMBER_INPUT}
                    />
                </label>
                <span className="mb-3 text-faint md:mb-2.5 md:text-sm">×</span>
                <label className="flex flex-col gap-1">
                    <span className="text-[13px] text-muted md:text-xs">{t('reps')}</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={targetReps}
                        onChange={(e) => setTargetReps(e.target.value)}
                        className={NUMBER_INPUT}
                    />
                </label>
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
                    className={`${PRIMARY} mb-0.5`}
                >
                    {t('add')}
                </button>
                <button type="button" onClick={onDone} className={`${BUTTON} mb-0.5`}>{t('doneAdding')}</button>
            </div>
        </div>
    )
}
