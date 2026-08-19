'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
}: CycleSchedulerProps) {
    const supabase = createClient()

    const [cycleId, setCycleId] = useState<string | null>(initialCycle?.id ?? null)
    const [cycleLength, setCycleLength] = useState<number>(initialCycle?.cycleLength ?? 7)
    const [lengthInput, setLengthInput] = useState(String(initialCycle?.cycleLength ?? 7))
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
            setError('Enter a cycle length of at least 1 day.')
            return
        }

        setIsSaving(true)
        try {
            const todayIso = new Date().toISOString().split('T')[0]
            const { data: cycle, error: cycleError } = await supabase
                .from('training_cycles')
                .insert({ user_id: userId, cycle_length: length, start_date: todayIso })
                .select('id')
                .single()

            if (cycleError || !cycle) {
                throw new Error(cycleError?.message ?? 'Failed to create cycle')
            }

            const newDays = Array.from({ length }, (_, i) => ({
                training_cycle_id: cycle.id,
                day_index: i + 1,
                routine_id: null,
            }))
            const { error: daysError } = await supabase.from('cycle_days').insert(newDays)
            if (daysError) throw new Error(daysError.message)

            setCycleId(cycle.id)
            setCycleLength(length)
            setDays(newDays.map((d) => ({ dayIndex: d.day_index, routineId: null })))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        } finally {
            setIsSaving(false)
        }
    }

    function handleRequestLengthChange(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        const newLength = Number(lengthInput)

        if (!newLength || newLength < 1) {
            setError('Enter a cycle length of at least 1 day.')
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
            if (updateError) throw new Error(updateError.message)

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
                if (insertError) throw new Error(insertError.message)

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
                if (deleteError) throw new Error(deleteError.message)

                setDays((prev) => prev.filter((d) => d.dayIndex <= pending.newLength))
            }

            setCycleLength(pending.newLength)
            setPending(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
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

        if (upsertError) {
            setError(upsertError.message)
            return
        }

        setDays((prev) =>
            prev.map((d) => (d.dayIndex === dayIndex ? { ...d, routineId: value } : d))
        )
    }

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-semibold uppercase tracking-wide">Training Cycle</h2>

            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}

            {!cycleId ? (
                <form
                    onSubmit={handleCreateCycle}
                    className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm"
                >
                    <div className="space-y-1">
                        <label htmlFor="cycleLength" className="text-sm font-medium">
                            How many days is your cycle?
                        </label>
                        <input
                            id="cycleLength"
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
                        className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                    >
                        {isSaving ? 'Creating...' : 'Create Cycle'}
                    </button>
                </form>
            ) : (
                <>
                    <form
                        onSubmit={handleRequestLengthChange}
                        className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm"
                    >
                        <div className="flex items-end gap-3">
                            <div className="space-y-1">
                                <label htmlFor="cycleLength" className="text-sm font-medium">
                                    Cycle length (days)
                                </label>
                                <input
                                    id="cycleLength"
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
                                Update Length
                            </button>
                        </div>
                    </form>

                    <div className="rounded-2xl border border-ink/10 bg-white p-6 space-y-2 shadow-sm">
                        {days.map((day) => (
                            <div key={day.dayIndex} className="flex items-center justify-between gap-3">
                                <span className="text-sm font-medium w-16 shrink-0">
                                    Day {day.dayIndex}
                                </span>
                                <select
                                    value={day.routineId ?? ''}
                                    onChange={(e) => handleDayChange(day.dayIndex, e.target.value)}
                                    className="flex-1 rounded-md border px-3 py-2 text-sm"
                                >
                                    <option value="">Rest day</option>
                                    {routines.map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name}
                                        </option>
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
                        <h3 className="font-semibold">Change cycle length?</h3>
                        <p className="text-sm text-ink/60">
                            Changing from {cycleLength} to {pending.newLength} days affects where
                            you are in the cycle.
                        </p>
                        <div className="flex flex-col gap-2">
                            {pending.canContinue && (
                                <button
                                    type="button"
                                    onClick={() => applyLengthChange(false)}
                                    disabled={isSaving}
                                    className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                                >
                                    Keep my current day, just extend the cycle
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => applyLengthChange(true)}
                                disabled={isSaving}
                                className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                            >
                                Restart from Day 1
                            </button>
                            <button
                                type="button"
                                onClick={() => setPending(null)}
                                disabled={isSaving}
                                className="rounded-md px-4 py-2 text-sm text-ink/60 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}