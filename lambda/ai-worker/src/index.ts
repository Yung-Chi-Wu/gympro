import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda'
import { getSupabaseClient, isRunnable, parseRequest, saveFailedStatus, saveInsufficientDataStatus, saveReport } from './supabase'
import { analyze } from './report/analyze'
import { fetchReportInputs } from './report/fetch'
import { generateNarrative, NARRATIVE_MODEL } from './report/narrative'
import { errorText, recordTrace, usageOfError } from '../../../lib/ai/trace'
import { periodDays } from '../../../lib/periods'
import type { ReportV3 } from './report/types'

const MINIMUM_SETS_FOR_ANALYSIS = 10
/** Kept back from the Lambda's timeout to save a failure and its trace: a run cut off saves nothing and stays pending */
const SAVE_MARGIN_MS = 15_000

async function processMessage(record: SQSRecord, deadline: number): Promise<void> {
  const request = parseRequest(record.body)
  if (!request) {
    // Acknowledged, not thrown: it would fail the same way on every redelivery
    console.error(`Dropping a message that is not a report request (messageId ${record.messageId})`)
    return
  }
  const { userId, periodStart } = request

  const supabase = await getSupabaseClient()

  // Each request runs once: a redelivered message whose run saved its result, or one a retry
  // has replaced, is acknowledged and left alone, so it can't run the model again or overwrite
  const runnable = await isRunnable(supabase, request)
  if (!runnable.run) {
    console.log(`Skipping report for user ${userId}, period ${periodStart}: ${runnable.why} (messageId ${record.messageId}, receive ${record.attributes.ApproximateReceiveCount})`)
    return
  }
  const { periodEnd, userNote } = runnable

  // messageId matches the one Next.js logs when it queues the request,
  // so a single report can be traced across Vercel and CloudWatch.
  console.log(
    `Processing recommendation for user ${userId}, period ${periodStart} to ${periodEnd} (messageId ${record.messageId})`
  )

  // The database holds periods to a cycle's length; this keeps a row from before that, or a
  // bad one, from sizing the report
  if (periodEnd === null || periodDays(periodStart, periodEnd) === null) {
    console.error(`Not reporting on user ${userId}, period ${periodStart} to ${periodEnd}: not a period a report covers (messageId ${record.messageId})`)
    await saveFailedStatus(supabase, request, 'Invalid report period.')
    return
  }

  try {
    const { inputs, language, weightUnit, distanceUnit } = await fetchReportInputs(supabase, userId, periodStart, periodEnd)

    // Code decides every number and which rules fire; the model writes the headline and advice
    const analysis = analyze(inputs)
    // Working sets: a week of treadmill sets alone has nothing for a strength report to compare
    const totalSets = analysis.facts.totalSets.now
    if (totalSets < MINIMUM_SETS_FOR_ANALYSIS) {
      console.log(
        `Skipping AI analysis for user ${userId}: only ${totalSets} sets logged (minimum ${MINIMUM_SETS_FOR_ANALYSIS})`
      )
      await saveInsufficientDataStatus(supabase, request, totalSets, MINIMUM_SETS_FOR_ANALYSIS)
      return
    }

    const started = Date.now()
    // The day notes go in as their own field, lined up with each day's plan, not only inside the brief
    const traceInput = { periodStart, periodEnd, language, weightUnit, distanceUnit, note: userNote ?? null, dayNotes: analysis.dayNotes }
    let narrative: ReportV3['narrative']
    try {
      const res = await generateNarrative({ ...analysis, note: userNote ?? null, language, weightUnit, distanceUnit }, NARRATIVE_MODEL, { deadline })
      narrative = res.narrative
      await recordTrace(supabase, {
        userId, feature: 'report', model: NARRATIVE_MODEL, servedModel: res.model, status: 'ok', latencyMs: Date.now() - started,
        usage: [res.usage], input: { ...traceInput, prompt: res.prompt }, output: { narrative, attempts: res.attempts, ...(res.fallback ? { fallback: res.fallback } : {}) },
      })
    } catch (err) {
      await recordTrace(supabase, {
        userId, feature: 'report', model: NARRATIVE_MODEL, status: 'error', error: errorText(err), latencyMs: Date.now() - started,
        usage: usageOfError(err), input: { ...traceInput, prompt: (err as { prompt?: string }).prompt ?? null },
      })
      throw err
    }
    const report: ReportV3 = { version: 3, ...analysis, narrative }
    await saveReport(supabase, request, report, userNote ?? null)
    console.log(`Successfully saved recommendation for user ${userId} (messageId ${record.messageId})`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(
      `Failed to process recommendation for user ${userId} (messageId ${record.messageId}):`,
      errorMessage
    )
    await saveFailedStatus(supabase, request, errorMessage)
    // Thrown for the Lambda Errors alarm; the redelivery finds the row failed and skips it
    throw err
  }
}

export const handler: SQSHandler = async (event: SQSEvent, context) => {
  console.log(`Received ${event.Records.length} message(s) from SQS`)

  for (const record of event.Records) {
    await processMessage(record, Date.now() + context.getRemainingTimeInMillis() - SAVE_MARGIN_MS)
  }
}
