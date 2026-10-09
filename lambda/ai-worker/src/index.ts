import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda'
import { getSupabaseClient, saveFailedStatus, saveInsufficientDataStatus, saveReport } from './supabase'
import { analyze } from './report/analyze'
import { fetchReportInputs } from './report/fetch'
import { generateNarrative, NARRATIVE_MODEL } from './report/narrative'
import { errorText, recordTrace, usageOfError } from '../../../lib/ai/trace'
import type { ReportV3 } from './report/types'
import type { AnalysisRequestMessage } from './types'

const MINIMUM_SETS_FOR_ANALYSIS = 10

async function processMessage(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body) as AnalysisRequestMessage
  const { userId, periodStart, periodEnd, userNote, language: messageLanguage } = message

  // messageId matches the one Next.js logs when it queues the request,
  // so a single report can be traced across Vercel and CloudWatch.
  console.log(
    `Processing recommendation for user ${userId}, period ${periodStart} to ${periodEnd} (messageId ${record.messageId})`
  )

  const supabase = await getSupabaseClient()

  try {
    const { inputs, language: profileLanguage, weightUnit } = await fetchReportInputs(supabase, userId, periodStart, periodEnd)
    const language = messageLanguage ?? profileLanguage

    const totalSets = inputs.sets.filter((s) => s.date >= periodStart).length
    if (totalSets < MINIMUM_SETS_FOR_ANALYSIS) {
      console.log(
        `Skipping AI analysis for user ${userId}: only ${totalSets} sets logged (minimum ${MINIMUM_SETS_FOR_ANALYSIS})`
      )
      await saveInsufficientDataStatus(supabase, userId, periodStart, totalSets, MINIMUM_SETS_FOR_ANALYSIS)
      return
    }

    // Code decides every number and which rules fire; the model writes the headline and advice
    const analysis = analyze(inputs)
    const started = Date.now()
    const traceInput = { periodStart, periodEnd, language, weightUnit, note: userNote ?? null }
    let narrative: ReportV3['narrative']
    try {
      const res = await generateNarrative({ ...analysis, note: userNote ?? null, language, weightUnit })
      narrative = res.narrative
      await recordTrace(supabase, {
        userId, feature: 'report', model: NARRATIVE_MODEL, servedModel: res.model, status: 'ok', latencyMs: Date.now() - started,
        usage: [res.usage], input: { ...traceInput, prompt: res.prompt }, output: { narrative, attempts: res.attempts },
      })
    } catch (err) {
      await recordTrace(supabase, {
        userId, feature: 'report', model: NARRATIVE_MODEL, status: 'error', error: errorText(err), latencyMs: Date.now() - started,
        usage: usageOfError(err), input: { ...traceInput, prompt: (err as { prompt?: string }).prompt ?? null },
      })
      throw err
    }
    const report: ReportV3 = { version: 3, ...analysis, narrative }
    await saveReport(supabase, userId, periodStart, report, userNote ?? null)
    console.log(`Successfully saved recommendation for user ${userId} (messageId ${record.messageId})`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(
      `Failed to process recommendation for user ${userId} (messageId ${record.messageId}):`,
      errorMessage
    )
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
