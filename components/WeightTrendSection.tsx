'use client'

import { useState } from 'react'
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'

interface WeightEntry {
    id: string
    recordedAt: string
    weightKg: number | null
}

interface WeightTrendSectionProps {
    userId: string
    entries: WeightEntry[]
}

export function WeightTrendSection({ userId, entries: initialEntries }: WeightTrendSectionProps) {
    const supabase = createClient()
    const [entries, setEntries] = useState<WeightEntry[]>(initialEntries)

    const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
    const [weightKg, setWeightKg] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const chartData = entries
        .filter((e) => e.weightKg !== null)
        .map((e) => ({
            date: e.recordedAt,
            label: formatShortDate(e.recordedAt),
            weightKg: e.weightKg as number,
        }))

    async function handleAddEntry(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        const weightNum = Number(weightKg)
        if (!weightKg || weightNum <= 0) {
            setError('Enter a valid weight.')
            return
        }

        setIsSaving(true)
        try {
            const recordedAt = new Date(`${date}T12:00:00`).toISOString()

            const { data, error: insertError } = await supabase
                .from('body_metrics')
                .insert({ user_id: userId, weight_kg: weightNum, recorded_at: recordedAt })
                .select('id, recorded_at, weight_kg')
                .single()

            if (insertError || !data) {
                throw new Error(insertError?.message ?? 'Failed to save weight')
            }

            setEntries((prev) =>
                [
                    ...prev,
                    { id: data.id, recordedAt: data.recorded_at, weightKg: data.weight_kg },
                ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
            )
            setWeightKg('')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong.')
        } finally {
            setIsSaving(false)
        }
    }

    async function handleDeleteEntry(id: string) {
        setError(null)
        const { error: deleteError } = await supabase.from('body_metrics').delete().eq('id', id)

        if (deleteError) {
            setError(deleteError.message)
            return
        }
        setEntries((prev) => prev.filter((e) => e.id !== id))
    }

    const mostRecentFirst = [...entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))

    return (
        <section className="space-y-4">
            <h2 className="text-lg font-semibold uppercase tracking-wide">Weight</h2>

            <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
                {chartData.length >= 2 ? (
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                                <CartesianGrid stroke="#2B2B2814" vertical={false} />
                                <XAxis
                                    dataKey="label"
                                    tick={{ fontSize: 12, fill: '#2B2B2899' }}
                                    axisLine={{ stroke: '#2B2B2822' }}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 12, fill: '#2B2B2899' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={40}
                                    domain={['dataMin - 2', 'dataMax + 2']}
                                />
                                <Tooltip
                                    formatter={(value: number) => [`${value} kg`, 'Weight']}
                                    labelStyle={{ color: '#2B2B28' }}
                                    contentStyle={{
                                        border: '1px solid #2B2B2822',
                                        borderRadius: 8,
                                        fontSize: 13,
                                    }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="weightKg"
                                    stroke="#26241F"
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: '#26241F' }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <p className="text-sm text-ink/60">
                        Log at least two weigh-ins to see a trend line here.
                    </p>
                )}
            </div>

            <form
                onSubmit={handleAddEntry}
                className="rounded-2xl border border-ink/10 bg-white p-6 space-y-3 shadow-sm"
            >
                {error && (
                    <p role="alert" className="text-sm text-red-600">
                        {error}
                    </p>
                )}
                <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                        <label htmlFor="metricDate" className="text-sm font-medium">
                            Date
                        </label>
                        <input
                            id="metricDate"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="flex-1 space-y-1">
                        <label htmlFor="metricWeight" className="text-sm font-medium">
                            Weight (kg)
                        </label>
                        <input
                            id="metricWeight"
                            type="number"
                            step="0.1"
                            value={weightKg}
                            onChange={(e) => setWeightKg(e.target.value)}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={isSaving}
                    className="rounded-md bg-plate px-4 py-2 font-display uppercase tracking-wide text-chalk hover:bg-plate-light disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Log Weight'}
                </button>
            </form>

            {mostRecentFirst.length > 0 && (
                <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
                    <h3 className="text-sm font-semibold text-ink/60 uppercase tracking-wide mb-3">
                        History
                    </h3>
                    <div className="space-y-2">
                        {mostRecentFirst.map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between text-sm">
                                <span>{formatShortDate(entry.recordedAt)}</span>
                                <div className="flex items-center gap-3">
                                    <span className="font-mono">{entry.weightKg} kg</span>
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteEntry(entry.id)}
                                        aria-label="Delete entry"
                                        className="text-ink/40 hover:text-red-600"
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    )
}

function formatShortDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    })
}