// ---------- Incoming SQS message shape ----------
// periodEnd is now required — period length varies (7 days for regular
// users, the user's own cycle_length for Pro users), so ai-worker can no
// longer derive the end date by assuming a fixed +6 days.
export interface AnalysisRequestMessage {
  userId: string
  periodStart: string // ISO date, e.g. "2026-08-17"
  periodEnd: string // ISO date, e.g. "2026-08-23"
  userNote?: string
}

// ---------- What the Supabase RPC + our own follow-up queries produce ----------
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

// ---------- What Claude actually has to generate ----------
// Deliberately narrative/judgment fields only. The quantitative fields
// (weeklyVolume, volumeSplit, strengthIndex) are computed directly from
// the database and merged in afterward in index.ts — Claude is never
// asked to recompute or restate numbers it was only given to read.
export interface AiNarrative {
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

// ---------- The full record we actually store ----------
export interface AiRecommendation extends AiNarrative {
  weeklyVolume: {
    totalSets: number
    totalTonnageKg: number
    byMuscleGroup: Record<string, { sets: number; tonnageKg: number }>
  }
  volumeSplit: Record<string, number>
  strengthIndex: Record<string, { currentIndex: number; previousIndex: number | null }>
}