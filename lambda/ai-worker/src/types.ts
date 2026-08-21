export interface AnalysisRequestMessage {
  userId: string
  periodStart: string
  periodEnd: string
  userNote?: string
  language?: string
}

export interface TrainingPeriodSummary {
  userContext: {
    heightCm: number | null
    latestWeightKg: number | null
    weightRecordedAt: string | null
    ageYears: number | null
    sex: string | null
    bmi: number | null
  }
  targetPeriod: {
    periodStart: string
    periodEnd: string
    totalSets: number
    totalTonnageKg: number
    tonnagePerBodyweightKg: number | null
    byMuscleGroup: Record<string, { sets: number; tonnageKg: number }>
  }
  volumeSplit: Record<string, number>
  strengthIndex: Record<string, { currentIndex: number; previousIndex: number | null }>
  routineAdherence: {
    followedRoutines: string[]
    missedRoutines: string[]
  }
}

export interface AiNarrative {
  headline: string
  summary: string
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
  contextSummary: string
}

export interface AiRecommendation extends AiNarrative {
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
}