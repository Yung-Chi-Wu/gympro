'use client'

import { useRouter } from 'next/navigation'

export interface PeriodOption {
    start: string // ISO date
    end: string // ISO date
}

interface PeriodSelectorProps {
    periods: PeriodOption[]
    selectedPeriodStart: string
}

export function PeriodSelector({ periods, selectedPeriodStart }: PeriodSelectorProps) {
    const router = useRouter()

    return (
        <select
            value={selectedPeriodStart}
            onChange={(e) => router.push(`/history?period=${e.target.value}`)}
            className="rounded-md border px-3 py-2"
        >
            {periods.map((period) => (
                <option key={period.start} value={period.start}>
                    {formatRange(period.start, period.end)}
                </option>
            ))}
        </select>
    )
}

function formatRange(start: string, end: string): string {
    const format = (d: string) =>
        new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${format(start)} – ${format(end)}`
}