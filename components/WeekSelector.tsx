'use client'

import { useRouter } from 'next/navigation'

interface WeekSelectorProps {
    weeks: string[] // ISO date strings, each the Monday of a week
    selectedWeek: string
}

export function WeekSelector({ weeks, selectedWeek }: WeekSelectorProps) {
    const router = useRouter()

    return (
        <select
            value={selectedWeek}
            onChange={(e) => router.push(`/history?week=${e.target.value}`)}
            className="rounded-md border px-3 py-2"
        >
            {weeks.map((week) => (
                <option key={week} value={week}>
                    Week of {new Date(week).toLocaleDateString()}
                </option>
            ))}
        </select>
    )
}