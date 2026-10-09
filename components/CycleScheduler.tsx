'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { toFriendlyError } from '@/lib/friendly-error'
import { addDays, daysBetween } from '@/lib/periods'
import { MoreMenu } from './MoreMenu'

// The training cycle: how many days one round lasts and which routine each day trains.
// Side by side with the routines (@split) it is one strip of days with today outlined;
// 編輯循環 turns the days into pickers and shows the length and delete controls. On a
// phone (the 循環 tab) the days are a list, always editable.

interface RoutineOption {
    id: string
    name: string
}

export interface CycleDayState {
    dayIndex: number
    routineId: string | null
}

interface CycleSchedulerProps {
    userId: string
    routines: RoutineOption[]
    initialCycle: { id: string; cycleLength: number; startDate: string } | null
    /** The cycle's days; the routines page keeps them, so its list can say which days each routine is on */
    days: CycleDayState[]
    setDays: Dispatch<SetStateAction<CycleDayState[]>>
    /** Today in the user's time zone, YYYY-MM-DD */
    today: string
    language: string
}

type PendingLengthChange = {
    newLength: number
    canContinue: boolean
}

// Phone sizes first (44px targets, 15px text), the denser desktop ones from md
const INPUT = 'h-11 w-full rounded-[9px] border border-line bg-card px-3 text-base md:h-auto md:py-2 md:text-sm'
const PRIMARY = 'min-h-11 rounded-[9px] bg-accent px-5 text-[15px] font-bold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50 md:min-h-0 md:px-4 md:py-2 md:text-sm'

export function CycleScheduler({
    userId,
    routines,
    initialCycle,
    days,
    setDays,
    today,
    language,
}: CycleSchedulerProps) {
    const supabase = createClient()
    const zh = language === 'zh-TW'
    const t = useTranslations('routines')

    const [cycleId, setCycleId] = useState<string | null>(initialCycle?.id ?? null)
    const [cycleLength, setCycleLength] = useState<number>(initialCycle?.cycleLength ?? 7)
    const [startDate, setStartDate] = useState<string | null>(initialCycle?.startDate ?? null)
    const [lengthInput, setLengthInput] = useState(String(initialCycle?.cycleLength ?? 7))
    const [todayDayInput, setTodayDayInput] = useState('1')
    const [pending, setPending] = useState<PendingLengthChange | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [editing, setEditing] = useState(false)

    // Which day of the cycle today is, counted the way the dashboard counts it
    const todayIndex = cycleId && startDate
        ? (((daysBetween(startDate, today) % cycleLength) + cycleLength) % cycleLength) + 1
        : null
    const routineName = (id: string | null) => routines.find((r) => r.id === id)?.name ?? null

    async function handleCreateCycle(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        const length = Number(lengthInput)
        if (!length || length < 1) {
            setError(zh ? '請輸入至少 1 天的循環長度。' : 'Enter a cycle length of at least 1 day.')
            return
        }

        const todayDay = Number(todayDayInput)
        if (!todayDay || todayDay < 1 || todayDay > length) {
            setError(zh
                ? `「今天是第幾天」必須在 1 到 ${length} 之間。`
                : `"Today is day..." must be between 1 and ${length}.`)
            return
        }

        setIsSaving(true)
        try {
            const startDateIso = addDays(today, -(todayDay - 1))
            const { data: cycle, error: cycleError } = await supabase
                .from('training_cycles')
                .insert({ user_id: userId, cycle_length: length, start_date: startDateIso })
                .select('id')
                .single()

            if (cycleError || !cycle) throw new Error(toFriendlyError(cycleError, language))

            const newDays = Array.from({ length }, (_, i) => ({
                training_cycle_id: cycle.id,
                day_index: i + 1,
                routine_id: null,
            }))
            const { error: daysError } = await supabase.from('cycle_days').insert(newDays)
            if (daysError) throw new Error(toFriendlyError(daysError, language))

            setCycleId(cycle.id)
            setCycleLength(length)
            setStartDate(startDateIso)
            setDays(newDays.map((d) => ({ dayIndex: d.day_index, routineId: null })))
            // A new cycle's days are all rest days: go straight to picking routines
            setEditing(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : (zh ? '發生錯誤，請再試一次。' : 'Something went wrong.'))
        } finally {
            setIsSaving(false)
        }
    }

    async function handleDeleteCycle() {
        if (!cycleId) return
        const confirmMsg = zh
            ? '確定刪除訓練循環？你的課表內容會保留，但每天的排程安排會被清除。'
            : 'Delete your training cycle? Your routines will stay, but the day-by-day schedule will be cleared.'
        if (!confirm(confirmMsg)) return

        setError(null)
        setIsSaving(true)
        try {
            const { error: deleteError } = await supabase
                .from('training_cycles')
                .delete()
                .eq('id', cycleId)
            if (deleteError) throw new Error(toFriendlyError(deleteError, language))

            await clearEmptyTodayWorkout(userId)
            setCycleId(null)
            setStartDate(null)
            setDays([])
            setLengthInput('7')
            setTodayDayInput('1')
            setEditing(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : (zh ? '發生錯誤，請再試一次。' : 'Something went wrong.'))
        } finally {
            setIsSaving(false)
        }
    }

    async function clearEmptyTodayWorkout(userId: string): Promise<void> {
        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

        const { data: todayWorkout } = await supabase
            .from('workouts')
            .select('id')
            .eq('user_id', userId)
            .gte('performed_at', startOfDay.toISOString())
            .lte('performed_at', endOfDay.toISOString())
            .order('performed_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (!todayWorkout) return

        const { count } = await supabase
            .from('workout_sets')
            .select('id', { count: 'exact', head: true })
            .eq('workout_id', todayWorkout.id)

        if (!count || count === 0) {
            await supabase.from('workouts').delete().eq('id', todayWorkout.id)
        }
    }

    function handleRequestLengthChange(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        const newLength = Number(lengthInput)
        if (!newLength || newLength < 1) {
            setError(zh ? '請輸入至少 1 天的循環長度。' : 'Enter a cycle length of at least 1 day.')
            return
        }
        if (newLength === cycleLength) return
        setPending({ newLength, canContinue: newLength > cycleLength })
    }

    async function applyLengthChange(resetStartDate: boolean) {
        if (!pending || !cycleId) return
        setIsSaving(true)
        setError(null)

        try {
            const updates: { cycle_length: number; start_date?: string } = {
                cycle_length: pending.newLength,
            }
            if (resetStartDate) {
                updates.start_date = today
            }

            const { error: updateError } = await supabase
                .from('training_cycles')
                .update(updates)
                .eq('id', cycleId)
            if (updateError) throw new Error(toFriendlyError(updateError, language))

            if (pending.newLength > cycleLength) {
                const newRows = Array.from(
                    { length: pending.newLength - cycleLength },
                    (_, i) => ({
                        training_cycle_id: cycleId,
                        day_index: cycleLength + i + 1,
                        routine_id: null,
                    })
                )
                const { error: insertError } = await supabase.from('cycle_days').insert(newRows)
                if (insertError) throw new Error(toFriendlyError(insertError, language))
                setDays((prev) => [
                    ...prev,
                    ...newRows.map((r) => ({ dayIndex: r.day_index, routineId: null })),
                ])
            } else {
                const { error: deleteError } = await supabase
                    .from('cycle_days')
                    .delete()
                    .eq('training_cycle_id', cycleId)
                    .gt('day_index', pending.newLength)
                if (deleteError) throw new Error(toFriendlyError(deleteError, language))
                setDays((prev) => prev.filter((d) => d.dayIndex <= pending.newLength))
            }

            setCycleLength(pending.newLength)
            if (resetStartDate) setStartDate(today)
            setPending(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : (zh ? '發生錯誤，請再試一次。' : 'Something went wrong.'))
        } finally {
            setIsSaving(false)
        }
    }

    async function handleDayChange(dayIndex: number, routineId: string) {
        if (!cycleId) return
        setError(null)
        const value = routineId === '' ? null : routineId
        const { error: upsertError } = await supabase
            .from('cycle_days')
            .upsert(
                { training_cycle_id: cycleId, day_index: dayIndex, routine_id: value },
                { onConflict: 'training_cycle_id,day_index' }
            )
        if (upsertError) { setError(toFriendlyError(upsertError, language)); return }
        setDays((prev) =>
            prev.map((d) => (d.dayIndex === dayIndex ? { ...d, routineId: value } : d))
        )
    }

    return (
        <section className="space-y-3 rounded-[14px] border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-base font-bold tracking-wide md:text-[15px]">{t('trainingCycle')}</h2>
                    {cycleId && todayIndex && (
                        <p className="text-[13px] text-muted">{t('cycleSummary', { length: cycleLength, today: todayIndex })}</p>
                    )}
                </div>
                {cycleId && (
                    <button
                        type="button"
                        onClick={() => setEditing((v) => !v)}
                        className="hidden min-h-9 shrink-0 text-[13px] font-medium text-accent @split:block"
                    >
                        {editing ? t('doneEditingCycle') : t('editCycle')}
                    </button>
                )}
                {/* As a list (phone) the days are always editable; deleting the cycle waits behind ⋯ */}
                {cycleId && (
                    <MoreMenu
                        label={t('cycleActions')}
                        className="-mr-2 -mt-2 @split:hidden"
                        items={[{ label: t('deleteCycle'), onSelect: handleDeleteCycle, danger: true }]}
                    />
                )}
            </div>

            {error && <p role="alert" className="text-[15px] text-miss md:text-sm">{error}</p>}

            {!cycleId ? (
                <form onSubmit={handleCreateCycle} className="space-y-3">
                    <p className="text-[15px] text-muted md:text-[13px]">{t('noCycleHint')}</p>
                    <div className="grid max-w-md grid-cols-2 gap-3">
                        <label className="space-y-1">
                            <span className="text-[13px] font-medium text-muted md:text-xs">{t('cycleLengthLabel')}</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={lengthInput}
                                onChange={(e) => setLengthInput(e.target.value)}
                                className={`${INPUT} font-mono`}
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-[13px] font-medium text-muted md:text-xs">{t('todayDayLabel')}</span>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={todayDayInput}
                                onChange={(e) => setTodayDayInput(e.target.value)}
                                className={`${INPUT} font-mono`}
                            />
                        </label>
                    </div>
                    <button type="submit" disabled={isSaving} className={PRIMARY}>
                        {isSaving ? t('creating') : t('createCycle')}
                    </button>
                </form>
            ) : (
                <>
                    {/* The days: a list on a phone, one strip side by side with the routines */}
                    <ol className="divide-y divide-line @split:flex @split:gap-1.5 @split:divide-y-0 @split:overflow-x-auto @split:pb-1">
                        {days.map((day) => {
                            const name = routineName(day.routineId)
                            const isToday = day.dayIndex === todayIndex
                            return (
                                <li
                                    key={day.dayIndex}
                                    aria-current={isToday ? 'date' : undefined}
                                    className={`flex min-h-[52px] items-center justify-between gap-3 py-1.5 @split:min-h-0 @split:min-w-[92px] @split:flex-1 @split:flex-col @split:items-stretch @split:justify-start @split:gap-0.5 @split:rounded-[10px] @split:border @split:px-1.5 @split:py-2 @split:text-center ${name ? '@split:border-line @split:bg-card' : '@split:border-dashed @split:border-line'} ${isToday ? '@split:shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : ''}`}
                                >
                                    <span className={`w-[7.5rem] shrink-0 text-[15px] md:w-auto md:text-xs @split:text-[11px] ${isToday ? 'font-bold text-accent' : 'text-muted md:text-faint'}`}>
                                        {t('dayN', { n: day.dayIndex })}
                                        {isToday && <span className="@split:hidden">{t('todayMark')}</span>}
                                    </span>

                                    {/* Side by side, the name; the picker while editing. On a phone, always the picker. */}
                                    <span className={`truncate text-[13px] font-bold ${name ? '' : 'font-medium text-faint'} hidden ${editing ? '' : '@split:block'}`}>
                                        {name ?? t('restDay')}
                                    </span>
                                    <span className={`min-w-0 flex-1 @split:flex-none ${editing ? '' : '@split:hidden'}`}>
                                        {routines.length === 0 ? (
                                            <span className="block py-2 text-right text-[15px] text-faint md:text-[13px] @split:text-center">{t('addRoutineFirst')}</span>
                                        ) : (
                                            <select
                                                value={name ? day.routineId ?? '' : ''}
                                                onChange={(e) => handleDayChange(day.dayIndex, e.target.value)}
                                                aria-label={t('dayN', { n: day.dayIndex })}
                                                className="h-11 w-full rounded-[9px] border border-line bg-card px-3 text-base md:h-auto md:px-2 md:py-1.5 md:text-sm"
                                            >
                                                <option value="">{t('restDay')}</option>
                                                {routines.map((r) => (
                                                    <option key={r.id} value={r.id}>{r.name}</option>
                                                ))}
                                            </select>
                                        )}
                                    </span>
                                </li>
                            )
                        })}
                    </ol>

                    {/* Length and delete: always on a phone, while editing side by side */}
                    <form
                        onSubmit={handleRequestLengthChange}
                        className={`flex flex-wrap items-center gap-3 border-t border-line pt-4 md:pt-3 ${editing ? '' : '@split:hidden'}`}
                    >
                        <span className="text-[15px] text-muted md:text-[13px]">{t('cycleLength')}</span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setLengthInput(String(Math.max(1, Number(lengthInput) - 1)))}
                                aria-label={t('shorterCycle')}
                                className="flex size-11 items-center justify-center rounded-full border border-line text-lg leading-none text-muted hover:text-ink md:size-8"
                            >
                                −
                            </button>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={lengthInput}
                                onChange={(e) => setLengthInput(e.target.value)}
                                aria-label={t('cycleLength')}
                                className="h-11 w-12 border-none bg-transparent text-center font-mono text-lg font-bold outline-none md:h-auto md:text-base"
                            />
                            <button
                                type="button"
                                onClick={() => setLengthInput(String(Number(lengthInput) + 1))}
                                aria-label={t('longerCycle')}
                                className="flex size-11 items-center justify-center rounded-full border border-line text-lg leading-none text-muted hover:text-ink md:size-8"
                            >
                                ＋
                            </button>
                        </div>
                        <button type="submit" disabled={isSaving} className="min-h-11 rounded-[9px] border border-line px-4 text-[15px] font-bold disabled:opacity-50 md:min-h-0 md:px-3 md:py-1.5 md:text-[13px]">
                            {t('updateLength')}
                        </button>
                        <button
                            type="button"
                            onClick={handleDeleteCycle}
                            disabled={isSaving}
                            className="ml-auto hidden text-[13px] text-faint transition-colors hover:text-miss disabled:opacity-50 @split:block"
                        >
                            {t('deleteCycle')}
                        </button>
                    </form>
                </>
            )}

            {pending && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-sm space-y-4 rounded-[14px] bg-card p-6">
                        <h3 className="font-semibold">
                            {zh ? '變更循環天數？' : 'Change cycle length?'}
                        </h3>
                        <p className="text-sm text-muted">
                            {zh
                                ? `從 ${cycleLength} 天改成 ${pending.newLength} 天會影響你目前在循環中的位置。`
                                : `Changing from ${cycleLength} to ${pending.newLength} days affects where you are in the cycle.`}
                        </p>
                        <div className="flex flex-col gap-2">
                            {pending.canContinue && (
                                <button
                                    type="button"
                                    onClick={() => applyLengthChange(false)}
                                    disabled={isSaving}
                                    className="min-h-11 rounded-[9px] border border-line px-4 text-[15px] disabled:opacity-50 md:min-h-0 md:py-2 md:text-sm"
                                >
                                    {zh ? '保留目前的進度，只延長循環天數' : 'Keep my current day, just extend the cycle'}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => applyLengthChange(true)}
                                disabled={isSaving}
                                className={PRIMARY}
                            >
                                {zh ? '從第一天重新開始' : 'Restart from Day 1'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setPending(null)}
                                disabled={isSaving}
                                className="min-h-11 rounded-[9px] px-4 text-[15px] text-muted disabled:opacity-50 md:min-h-0 md:py-2 md:text-sm"
                            >
                                {zh ? '取消' : 'Cancel'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}
