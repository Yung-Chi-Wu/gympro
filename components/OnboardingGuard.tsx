'use client'

import { useState, useEffect } from 'react'
import { OnboardingModal } from './OnboardingModal'

interface OnboardingGuardProps {
    userId: string
    language: string
    serverCompleted: boolean
}

export function OnboardingGuard({ userId, language, serverCompleted }: OnboardingGuardProps) {
    const [show, setShow] = useState(false)

    useEffect(() => {
        // 先檢查 localStorage，快過等 server
        const localCompleted = localStorage.getItem('onboarding_completed') === 'true'
        if (!serverCompleted && !localCompleted) {
            setShow(true)
        }
        // 如果 server 說完成了，同步 localStorage
        if (serverCompleted) {
            localStorage.setItem('onboarding_completed', 'true')
        }
    }, [serverCompleted])

    if (!show) return null

    return <OnboardingModal userId={userId} language={language} />
}