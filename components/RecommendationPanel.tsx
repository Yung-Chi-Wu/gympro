'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface RecommendationPanelProps {
    userId: string
}

type Status = 'idle' | 'pending' | 'completed' | 'insufficient_data' | 'failed'

export function RecommendationPanel({ userId }: RecommendationPanelProps) {
    const supabase = createClient()
    const [status, setStatus] = useState<Status>('idle')
    const [recommendation, setRecommendation] = useState<Record<string, unknown> | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // Monday of the current week, used consistently as the week identifier.
    const weekStart = getMostRecentMonday()

    const checkStatus = useCallback(async () => {
        const { data } = await supabase
            .from('ai_recommendations')
            .select('status, recommendation, error_message')
            .eq('user_id', userId)
            .eq('week_start', weekStart)
            .maybeSingle()

        if (!data) return

        setStatus(data.status as Status)
        if (data.status === 'completed') {
            setRecommendation(data.recommendation as Record<string, unknown>)
        }
        if (data.status === 'failed' || data.status === 'insufficient_data') {
            setErrorMessage(data.error_message)
        }
    }, [supabase, userId, weekStart])

    // Poll every 3 seconds while a request is pending.
    useEffect(() => {
        if (status !== 'pending') return

        const interval = setInterval(checkStatus, 3000)
        return () => clearInterval(interval)
    }, [status, checkStatus])

    // Check once on initial load, in case a recommendation already exists.
    useEffect(() => {
        checkStatus()
    }, [checkStatus])

    async function handleGenerate() {
        setStatus('pending')
        setErrorMessage(null)

        const res = await fetch('/api/recommendations/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekStart }),
        })

        if (!res.ok) {
            setStatus('failed')
            setErrorMessage('Failed to submit request. Please try again.')
        }
    }

    return (
        <div className="rounded-lg border p-6 space-y-4">
            {status === 'idle' && (
                <button
                    onClick={handleGenerate}
                    className="rounded-md bg-black px-4 py-2 text-white"
                >
                    Generate This Week's Recommendation
                </button>
            )}

            {status === 'pending' && (
                <div className="flex items-center gap-3 text-gray-600">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                    <span>Analyzing your training data...</span>
                </div>
            )}

            {status === 'completed' && recommendation && (
                <div>
                    <p className="font-medium">{String(recommendation.summary)}</p>
                    {/* TODO: render the full recommendation structure properly */}
                </div>
            )}

            {status === 'insufficient_data' && (
                <p className="text-gray-600">{errorMessage}</p>
            )}

            {status === 'failed' && (
                <p className="text-red-600">{errorMessage ?? 'Something went wrong.'}</p>
            )}
        </div>
    )
}

function getMostRecentMonday(): string {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(now.setDate(diff))
    return monday.toISOString().split('T')[0]
}