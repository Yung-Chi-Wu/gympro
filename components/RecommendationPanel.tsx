'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AiRecommendation } from './types'

interface RecommendationPanelProps {
    userId: string
}

type Status = 'idle' | 'pending' | 'completed' | 'insufficient_data' | 'failed'

const SEVERITY_STYLES: Record<string, string> = {
    mild: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    moderate: 'bg-orange-50 text-orange-800 border-orange-200',
    severe: 'bg-red-50 text-red-800 border-red-200',
}

export function RecommendationPanel({ userId }: RecommendationPanelProps) {
    const supabase = createClient()
    const [status, setStatus] = useState<Status>('idle')
    const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [noteInput, setNoteInput] = useState('')

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
            setRecommendation(data.recommendation as AiRecommendation)
        }
        if (data.status === 'failed' || data.status === 'insufficient_data') {
            setErrorMessage(data.error_message)
        }
    }, [supabase, userId, weekStart])

    useEffect(() => {
        if (status !== 'pending') return
        const interval = setInterval(checkStatus, 3000)
        return () => clearInterval(interval)
    }, [status, checkStatus])

    useEffect(() => {
        checkStatus()
    }, [checkStatus])

    async function handleGenerate() {
        setStatus('pending')
        setErrorMessage(null)

        const res = await fetch('/api/recommendations/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weekStart,
                userNote: noteInput.trim() || undefined,
            }),
        })

        if (!res.ok) {
            setStatus('failed')
            setErrorMessage('Failed to submit request. Please try again.')
        }
    }

    return (
        <div className="rounded-lg border p-6 space-y-4">
            {status === 'idle' && (
                <div className="space-y-3">
                    <div className="space-y-1">
                        <label htmlFor="userNote" className="text-sm font-medium">
                            Anything specific on your mind this week? (optional)
                        </label>
                        <textarea
                            id="userNote"
                            value={noteInput}
                            onChange={(e) => setNoteInput(e.target.value)}
                            placeholder="e.g. Want to focus more on back this week, shoulder felt tight..."
                            rows={2}
                            className="w-full rounded-md border px-3 py-2 text-sm"
                        />
                    </div>
                    <button
                        onClick={handleGenerate}
                        className="rounded-md bg-black px-4 py-2 text-white"
                    >
                        Generate This Week's Recommendation
                    </button>
                </div>
            )}

            {status === 'pending' && (
                <div className="flex items-center gap-3 text-gray-600">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                    <span>Analyzing your training data...</span>
                </div>
            )}

            {status === 'completed' && recommendation && (
                <RecommendationDisplay recommendation={recommendation} />
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

function RecommendationDisplay({ recommendation }: { recommendation: AiRecommendation }) {
    return (
        <div className="space-y-6">
            {/* Overall summary */}
            <p className="text-lg font-medium">{recommendation.summary}</p>

            {/* Weekly volume breakdown */}
            <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    This Week's Volume
                </h3>
                <p className="text-sm text-gray-600 mb-2">
                    {recommendation.weeklyVolume.totalSets} total sets ·{' '}
                    {recommendation.weeklyVolume.totalTonnageKg} kg total tonnage
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {Object.entries(recommendation.weeklyVolume.byMuscleGroup).map(
                        ([muscle, data]) => (
                            <div key={muscle} className="rounded border px-3 py-2 text-sm">
                                <span className="font-medium capitalize">{muscle}</span>:{' '}
                                {data.sets} sets, {data.tonnageKg} kg
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Progressive overload */}
            <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Progressive Overload
                </h3>
                <p className="text-sm text-gray-600">{recommendation.progressiveOverload.notes}</p>
            </div>

            {/* Muscle imbalances */}
            {recommendation.muscleImbalances.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Things to Watch
                    </h3>
                    <div className="space-y-2">
                        {recommendation.muscleImbalances.map((imbalance, i) => (
                            <div
                                key={i}
                                className={`rounded border px-3 py-2 text-sm ${SEVERITY_STYLES[imbalance.severity] ?? ''
                                    }`}
                            >
                                <span className="font-semibold capitalize">{imbalance.muscleGroup}</span>
                                {' — '}
                                {imbalance.observation}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Deload warning, only shown if relevant */}
            {recommendation.deloadRecommended && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <span className="font-semibold">Deload recommended: </span>
                    {recommendation.deloadReason}
                </div>
            )}

            {/* Action items */}
            <div>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    What To Do Next Week
                </h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                    {recommendation.actionItems.map((item, i) => (
                        <li key={i}>{item}</li>
                    ))}
                </ul>
            </div>
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