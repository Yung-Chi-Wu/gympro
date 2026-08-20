export interface PdfRequestMessage {
    userId: string
    periodStart: string
}

// Mirrors the shape ai-worker stores in period_reports.recommendation —
// duplicated here because this is a separate deployable Lambda with its
// own package.json, so it can't import ai-worker's types.ts directly.
export interface StoredRecommendation {
    summary: string
    weeklyVolume: {
        totalSets: number
        totalTonnageKg: number
        byMuscleGroup: Record<string, { sets: number; tonnageKg: number }>
    }
    volumeSplit: Record<string, number>
    strengthIndex: Record<string, { currentIndex: number; previousIndex: number | null }>
    progressiveOverload: {
        status: 'on_track' | 'stalling' | 'regressing' | 'insufficient_data'
        notes: string
    }
    muscleImbalances: Array<{
        muscleGroup: string
        severity: 'mild' | 'moderate' | 'severe'
        observation: string
    }>
    deloadRecommended: boolean
    deloadReason: string | null
    actionItems: string[]
}