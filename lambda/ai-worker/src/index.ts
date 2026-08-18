import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda'
import {
  getSupabaseClient,
  fetchWeeklyTrainingSummary,
  fetchPreviousContextSummary,
  fetchUserProfile,
  saveRecommendation,
  saveFailedStatus,
  saveInsufficientDataStatus,
} from './supabase'
import { generateRecommendation } from './claude'
import type { AnalysisRequestMessage } from './types'

const MINIMUM_SETS_FOR_ANALYSIS = 10

async function processMessage(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as AnalysisRequestMessage
  const { userId, weekStart, userNote } = message

  console.log(`Processing recommendation for user ${userId}, week ${weekStart}`)

  const supabase = await getSupabaseClient()

  try {
    const [trainingSummary, previousContext, userProfile] = await Promise.all([
      fetchWeeklyTrainingSummary(supabase, userId, weekStart),
      fetchPreviousContextSummary(supabase, userId, weekStart),
      fetchUserProfile(supabase, userId),
    ])

    const totalSets = trainingSummary.targetWeek.totalSets

    if (totalSets < MINIMUM_SETS_FOR_ANALYSIS) {
      console.log(
        `Skipping AI analysis for user ${userId}: only ${totalSets} sets logged (minimum ${MINIMUM_SETS_FOR_ANALYSIS})`
      )
      await saveInsufficientDataStatus(
        supabase,
        userId,
        weekStart,
        totalSets,
        MINIMUM_SETS_FOR_ANALYSIS
      )
      return
    }

    const recommendation = await generateRecommendation(
      trainingSummary,
      previousContext,
      userProfile.trainingGoal,
      userNote ?? null
    )

    await saveRecommendation(supabase, userId, weekStart, recommendation, userNote ?? null)

    console.log(`Successfully saved recommendation for user ${userId}`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`Failed to process recommendation for user ${userId}:`, errorMessage)
    await saveFailedStatus(supabase, userId, weekStart, errorMessage)
    throw err
  }
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log(`Received ${event.Records.length} message(s) from SQS`)

  for (const record of event.Records) {
    await processMessage(record)
  }
}