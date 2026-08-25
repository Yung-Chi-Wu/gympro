'use client'

import { useRouter } from 'next/navigation'
import { CoachGEntry } from './CoachGEntry'

interface CoachGEntryWrapperProps {
    hasRoutines: boolean
    routineCount: number
    language: string
    trainingGoal: string | null
}

export function CoachGEntryWrapper(props: CoachGEntryWrapperProps) {
    const router = useRouter()

    return (
        <CoachGEntry
            {...props}
            onRefresh={() => router.refresh()}
        />
    )
}