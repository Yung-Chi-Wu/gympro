// ---------- Incoming SQS message shape ----------
// This is what the Next.js API Route sends into the queue.
export interface AnalysisRequestMessage {
  userId: string
  weekStart: string // ISO date string, e.g. "2026-08-17"
  userNote?: string // Optional ad-hoc note for this specific week
}

// ---------- What the Supabase RPC function returns ----------
// This mirrors the JSON shape built by get_weekly_training_summary().
export interface WeeklyTrainingSummary {
  userContext: {
    heightCm: number | null
    latestWeightKg: number | null
    weightRecordedAt: string | null
    ageYears: number | null
    sex: string | null
    bmi: number | null
  }
  targetWeek: {
    weekStart: string
    weekEnd: string
    totalSets: number
    totalTonnageKg: number
    tonnagePerBodyweightKg: number | null
    byMuscleGroup: Record<string, { sets: number; tonnageKg: number }>
  }
  tonnageTrend: Array<{ weekStart: string; totalTonnageKg: number }>
  routineAdherence: {
    followedRoutines: string[]
    missedRoutines: string[]
  }
}

// ---------- The structured recommendation Claude must produce ----------
// This is the contract enforced via Claude's tool use feature.
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
  contextSummary: string
}