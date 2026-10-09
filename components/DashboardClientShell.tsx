'use client'

import { useState } from 'react'
import { TodayWorkoutCard } from './TodayWorkoutCard'
import { PeriodLogCard } from './PeriodLogCard'
import type { ExerciseOption } from './log-types'
import type { TodayExercise } from '@/lib/today-workout'
import type { WeightUnit } from '@/lib/weight-unit'
import type { Period } from '@/lib/periods'

interface DashboardClientShellProps {
    // TodayWorkoutCard props
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
    weightUnit: WeightUnit
    routineName: string | null
    // PeriodLogCard props
    latestWeightKg: number | null
    period: Period | null
    periodNote: string
    dayNote: string
}

export function DashboardClientShell({
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
    weightUnit: initialWeightUnit,
    routineName,
    latestWeightKg,
    period,
    periodNote,
    dayNote,
}: DashboardClientShellProps) {
    const [weightUnit, setWeightUnit] = useState<WeightUnit>(initialWeightUnit)

    return (
        <>
            <TodayWorkoutCard
                userId={userId}
                initialWorkoutId={initialWorkoutId}
                todayRange={todayRange}
                routineIdForToday={routineIdForToday}
                isRestDay={isRestDay}
                hasCycle={hasCycle}
                dayIndex={dayIndex}
                cycleLength={cycleLength}
                initialExercises={initialExercises}
                allExercises={allExercises}
                language={language}
                weightUnit={weightUnit}
                routineName={routineName}
                onWeightUnitChange={setWeightUnit}
            />
            <PeriodLogCard
                language={language}
                latestWeightKg={latestWeightKg}
                weightUnit={weightUnit}
                period={period}
                initialNote={periodNote}
                initialDayNote={dayNote}
            />
        </>
    )
}