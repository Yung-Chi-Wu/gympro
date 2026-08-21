export interface AiRecommendation {
    headline: string
    summary: string
    weeklyVolume: {
        totalSets: number
        totalTonnageKg: number
        byMuscleGroup: Record<string, { sets: number; tonnageKg: number }>
    }
    volumeSplit: Record<string, number>
    strengthIndex: Record<string, { currentIndex: number; previousIndex: number | null }>
    bodyMetrics: {
        weightKg: number | null
        heightCm: number | null
        bmi: number | null
        ageYears: number | null
        sex: string | null
    }
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