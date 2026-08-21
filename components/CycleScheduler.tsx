'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toFriendlyError } from '@/lib/friendly-error'

interface RoutineOption {
    id: string
    name: string
}

interface CycleDayState {
    dayIndex: number
    routineId: string | null
}

interface CycleSchedulerProps {
    userId: string
    routines: RoutineOption[]
    initialCycle: { id: string; cycleLength: number } | null
    initialCycleDays: CycleDayState[]
    language: string
}

type PendingLengthChange = {
    newLength: number
    canContinue: boolean
}

export function CycleScheduler({
    userId,
    routines,
    initialCycle,
    initialCycleDays,
    language,
}: CycleSchedulerProps) {
    const supabase = createClient()
    const zh = language === 'zh-TW'

    const [cycleId, setCycleId] = useState<string | null>(initialCycle?.id ?? null)
    const [cycleLength, setCycleLength] = useState<number>(initialCycle?.cycleLength ?? 7)
    const [lengthInput, setLengthInput] = useState(String(initialCycle?.cycleLength ?? 7))
    const [todayDayInput, setTodayDayInput] = useState('1')
    const [days, setDays] = useState<CycleDayState[]>(
        initialCycleDays.length > 0
            ? initialCycleDays
            : Array.from({ length: initialCycle?.cycleLength ?? 0 }, (_, i) => ({
                dayIndex: i + 1,
                routineId: null,
            }))
    )
    const [pending, setPending] = useState<PendingLengthChange | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)

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
            setError(zh ? `「今天是第幾天」必須在 1 到 ${length} 之間。` : `"Today is day..." must be between 1 and ${length}.`)
            return
        }

        setIsSaving(true)
        try {
            const startDate = addDaysToDate(new Date(), -(todayDay - 1))
            const startDateIso = startDate.toISOString().split('T')[0]
            const { data: cycle, error: cycleError } = await supabase
                .from('training_cycles')
                .insert({ user_id: userId, cycle_length: length, start_date: startDateIso })
                .select('id')
                .single()

            if (cycleError || !cycle) throw new Error(toFriendlyError(cycleError))

            const newDays = Array.from({ length }, (_, i) => ({
                training_cycle_id: cycle.id,
                day_index: i + 1,
                routine_id: null,
            }))
            const { error: daysError } = await supabase.from('cycle_days').insert(newDays)
            if (daysError) throw new Error(toFriendlyError(daysError))

            setCycleId(cycle.id)
            setCycleLength(length)
            setDays(newDays.map((d) => ({ dayIndex: d.day_index, routineId: null })))
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
            if (deleteError) throw new Error(toFriendlyError(deleteError))

            await clearEmptyTodayWorkout(userId)
            setCycleId(null)
            setDays([])
            setLengthInput('7')
            setTodayDayInput('1')
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
                updates.start_date = new Date().toISOString().split('T')[0]
            }

            const { error: updateError } = await supabase
                .from('training_cycles')
                .update(updates)
                .eq('id', cycleId)
            if (updateError) throw new Error(toFriendlyError(updateError))

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
                if (insertError) throw new Error(toFriendlyError(insertError))
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
                if (deleteError) throw new Error(toFriendlyError(deleteError))
                setDays((prev) => prev.filter((d) => d.dayIndex <= pending.newLength))
            }

            setCycleLength(pending.newLength)
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
        if (upsertError) { setError(toFriendlyError(upsertError)); return }
        setDays((prev) =>
            prev.map((d) => (d.dayIndex === dayIndex ? { ...d, routineId: value } : d))
        )
    }

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-semibold uppercase tracking-wide">
                {zh ? '訓練循環' : 'Training Cycle'}
            </h2>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            {!cycleId ? (
                <form
                    onSubmit={handleCreateCycle}
                    className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm"
                >
                    <div className="space-y-1">
                        <label className="text-sm font-medium">
                            {zh ? '你的訓練循環幾天一輪？' : 'How many days is your cycle?'}
                        </label>
                        <input
                            type="number"
                            min={1}
                            value={lengthInput}
                            onChange={(e) => setLengthInput(e.target.value)}
                            className="w-24 rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium">
                            {zh ? '今天是循環的第幾天？' : 'Which day of your cycle is today?'}
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={Number(lengthInput) || undefined}
                            value={todayDayInput}
                            onChange={(e) => setTodayDayInput(e.target.value)}
                            className="w-24 rounded-md border px-3 py-2 text-sm"
                        />
                        <p className="text-xs text-ink/40">
                            {zh
                                ? '如果你的訓練循環已經進行到一半，在這裡設定好讓系統對齊你現在的位置。'
                                : "If you're already partway through your routine in your head, set this so today lines up with the right day."}
                        </p>
                    </div>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                    >
                        {isSaving ? (zh ? '建立中...' : 'Creating...') : (zh ? '建立循環' : 'Create Cycle')}
                    </button>
                </form>
            ) : (
                <>
                    <form
                        onSubmit={handleRequestLengthChange}
                        className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm"
                    >
                        <div className="flex items-end justify-between gap-3">
                            <div className="flex items-end gap-3">
                                <div className="space-y-1">
                                    <label className="text-sm font-medium">
                                        {zh ? '循環天數' : 'Cycle length (days)'}
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={lengthInput}
                                        onChange={(e) => setLengthInput(e.target.value)}
                                        className="w-24 rounded-md border px-3 py-2 text-sm"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                                >
                                    {zh ? '更新天數' : 'Update Length'}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={handleDeleteCycle}
                                disabled={isSaving}
                                className="text-sm text-ink/40 hover:text-red-600 disabled:opacity-50"
                            >
                                {zh ? '刪除循環' : 'Delete cycle'}
                            </button>
                        </div>
                    </form>

                    <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-2 shadow-sm">
                        {days.map((day) => (
                            <div key={day.dayIndex} className="flex items-center justify-between gap-3">
                                <span className="text-sm font-medium w-20 shrink-0">
                                    {zh ? `第 ${day.dayIndex} 天` : `Day ${day.dayIndex}`}
                                </span>
                                <select
                                    value={day.routineId ?? ''}
                                    onChange={(e) => handleDayChange(day.dayIndex, e.target.value)}
                                    className="flex-1 rounded-md border px-3 py-2 text-sm"
                                >
                                    <option value="">{zh ? '休息日' : 'Rest day'}</option>
                                    {routines.map((r) => (
                                        <option key={r.id} value={r.id}>{r.name}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {pending && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
                    <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
                        <h3 className="font-semibold">
                            {zh ? '變更循環天數？' : 'Change cycle length?'}
                        </h3>
                        <p className="text-sm text-ink/60">
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
                                    className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                                >
                                    {zh ? '保留目前的進度，只延長循環天數' : 'Keep my current day, just extend the cycle'}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => applyLengthChange(true)}
                                disabled={isSaving}
                                className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                            >
                                {zh ? '從第一天重新開始' : 'Restart from Day 1'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setPending(null)}
                                disabled={isSaving}
                                className="rounded-md px-4 py-2 text-sm text-ink/60 disabled:opacity-50"
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

function addDaysToDate(date: Date, days: number): Date {
    const result = new Date(date)
    result.setDate(result.getDate() + days)
    return result
}