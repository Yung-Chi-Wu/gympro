'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { OnboardingModal } from './OnboardingModal'

interface OnboardingGuardProps {
    userId: string
    language: string
    serverCompleted: boolean
}

// localStorage doesn't announce changes in this tab; it is read when the guard renders
const subscribeNothing = () => () => {}

function completedLocally(): boolean {
    try {
        return localStorage.getItem('onboarding_completed') === 'true'
    } catch {
        // Storage can be blocked (private mode): fall back to what the server says
        return false
    }
}

export function OnboardingGuard({ userId, language, serverCompleted }: OnboardingGuardProps) {
    // 先檢查 localStorage，快過等 server；server 端先當作已完成，不閃一下
    const localCompleted = useSyncExternalStore(subscribeNothing, completedLocally, () => true)

    // 如果 server 說完成了，同步 localStorage
    useEffect(() => {
        if (!serverCompleted) return
        try {
            localStorage.setItem('onboarding_completed', 'true')
        } catch {
            // Storage blocked: the server's flag is enough
        }
    }, [serverCompleted])

    if (serverCompleted || localCompleted) return null

    return <OnboardingModal userId={userId} language={language} />
}