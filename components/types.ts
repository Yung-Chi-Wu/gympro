export interface AiRecommendation {
    summary: string
    weeklyVolume: {
        totalSets: number
        totalTonnageKg: number
        byMuscleGroup: Record<string, { sets: number; tonnageKg: number }>
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