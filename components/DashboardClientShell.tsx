'use client'

import { useState } from 'react'
import { TodayWorkoutCard } from './TodayWorkoutCard'
import { PeriodCheckInCard } from './PeriodCheckInCard'
import type { ExerciseOption } from './log-types'
import type { TodayExercise } from '@/app/(app)/dashboard/page'
import type { WeightUnit } from '@/lib/weight-unit'

interface DashboardClientShellProps {
    // TodayWorkoutCard props
    userId: string
    initialWorkoutId: string | null
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
    // PeriodCheckInCard props
    latestWeightKg: number | null
}

export function DashboardClientShell({
    userId,
    initialWorkoutId,
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
}: DashboardClientShellProps) {
    const [weightUnit, setWeightUnit] = useState<WeightUnit>(initialWeightUnit)

    return (
        <>
            <TodayWorkoutCard
                userId={userId}
                initialWorkoutId={initialWorkoutId}
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
            <PeriodCheckInCard
                language={language}
                latestWeightKg={latestWeightKg}
                weightUnit={weightUnit}
            />
        </>
    )
}