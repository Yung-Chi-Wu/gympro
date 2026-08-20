import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda'
import {
  getSupabaseClient,
  fetchTrainingPeriodSummary,
  fetchPreviousPeriod,
  fetchUserProfile,
  fetchRoutineAdherence,
  computeStrengthIndex,
  saveRecommendation,
  saveFailedStatus,
  saveInsufficientDataStatus,
  enqueuePdfGeneration,
} from './supabase'
import { generateRecommendation } from './claude'
import type { AnalysisRequestMessage, AiRecommendation } from './types'

const MINIMUM_SETS_FOR_ANALYSIS = 10

async function processMessage(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as AnalysisRequestMessage
  const { userId, periodStart, periodEnd, userNote } = message

  console.log(`Processing recommendation for user ${userId}, period ${periodStart} to ${periodEnd}`)

  const supabase = await getSupabaseClient()

  try {
    const [trainingSummary, previousPeriod, userProfile, routineAdherence] = await Promise.all([
      fetchTrainingPeriodSummary(supabase, userId, periodStart, periodEnd),
      fetchPreviousPeriod(supabase, userId, periodStart),
      fetchUserProfile(supabase, userId),
      fetchRoutineAdherence(supabase, userId, periodStart, periodEnd),
    ])

    trainingSummary.userContext.ageYears = userProfile.ageYears
    trainingSummary.userContext.sex = userProfile.sex
    trainingSummary.userContext.bmi = calculateBmi(
      trainingSummary.userContext.heightCm,
      trainingSummary.userContext.latestWeightKg
    )
    trainingSummary.routineAdherence = routineAdherence

    const totalSets = trainingSummary.targetPeriod.totalSets

    if (totalSets < MINIMUM_SETS_FOR_ANALYSIS) {
      console.log(
        `Skipping AI analysis for user ${userId}: only ${totalSets} sets logged (minimum ${MINIMUM_SETS_FOR_ANALYSIS})`
      )
      await saveInsufficientDataStatus(
        supabase,
        userId,
        periodStart,
        totalSets,
        MINIMUM_SETS_FOR_ANALYSIS
      )
      return
    }

    trainingSummary.strengthIndex = await computeStrengthIndex(
      supabase,
      userId,
      periodStart,
      periodEnd,
      previousPeriod.previousStrengthIndex
    )
    trainingSummary.volumeSplit = computeVolumeSplit(trainingSummary.targetPeriod)

    const narrative = await generateRecommendation(
      trainingSummary,
      previousPeriod.contextSummary,
      userProfile.trainingGoal,
      userNote ?? null
    )

    const recommendation: AiRecommendation = {
      ...narrative,
      weeklyVolume: {
        totalSets: trainingSummary.targetPeriod.totalSets,
        totalTonnageKg: trainingSummary.targetPeriod.totalTonnageKg,
        byMuscleGroup: trainingSummary.targetPeriod.byMuscleGroup,
      },
      volumeSplit: trainingSummary.volumeSplit,
      strengthIndex: trainingSummary.strengthIndex,
    }

    await saveRecommendation(supabase, userId, periodStart, recommendation, userNote ?? null)
    console.log(`Successfully saved recommendation for user ${userId}`)

    const pdfQueueUrl = process.env.PDF_QUEUE_URL
    if (pdfQueueUrl) {
      await enqueuePdfGeneration(pdfQueueUrl, userId, periodStart)
      console.log(`Queued PDF generation for user ${userId}`)
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`Failed to process recommendation for user ${userId}:`, errorMessage)
    await saveFailedStatus(supabase, userId, periodStart, errorMessage)
    throw err
  }
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log(`Received ${event.Records.length} message(s) from SQS`)

  for (const record of event.Records) {
    await processMessage(record)
  }
}

function calculateBmi(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg) return null
  const heightM = heightCm / 100
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10
}

function computeVolumeSplit(targetPeriod: {
  totalTonnageKg: number
  byMuscleGroup: Record<string, { tonnageKg: number }>
}): Record<string, number> {
  const total = targetPeriod.totalTonnageKg
  if (!total || total <= 0) return {}

  const split: Record<string, number> = {}
  for (const [muscleGroup, data] of Object.entries(targetPeriod.byMuscleGroup)) {
    split[muscleGroup] = Math.round((data.tonnageKg / total) * 1000) / 10
  }
  return split
}