import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda'
import { getSupabaseClient, isRunnable, parseRequest, saveFailedStatus, saveInsufficientDataStatus, saveReport } from './supabase'
import { analyze } from './report/analyze'
import { fetchReportInputs } from './report/fetch'
import { generateNarrative, NARRATIVE_MODEL } from './report/narrative'
import { GOAL_READER_MODEL, readGoal } from './report/goal'
import { readWeek, WEEK_READER_MODEL, type WeekText } from './report/week'
import { getClaudeClient } from './claude'
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
    await saveFailedStatus(supabase, request, 'invalid_period')
    return
  }

  try {
    const { inputs, language, weightUnit, distanceUnit, library, previousGoal, messages } = await fetchReportInputs(supabase, userId, periodStart, periodEnd)

    // Working sets: a week of treadmill sets alone has nothing for a strength report to compare.
    // Counted before anything is read, so a report that isn't written pays for no read.
    const totalSets = analyze(inputs).facts.totalSets.now
    if (totalSets < MINIMUM_SETS_FOR_ANALYSIS) {
      console.log(
        `Skipping AI analysis for user ${userId}: only ${totalSets} sets logged (minimum ${MINIMUM_SETS_FOR_ANALYSIS})`
      )
      await saveInsufficientDataStatus(supabase, request, totalSets, MINIMUM_SETS_FOR_ANALYSIS)
      return
    }

    // Read side by side: the goal, once per text (report/goal.ts), and what the user said this
    // period, in day notes and to Ronnie (report/week.ts). Either can fail and leave the report without it.
    const client = await getClaudeClient()
    const logged = new Set(inputs.sets.map((s) => s.exerciseId))
    const own = inputs.exercises.filter((e) => logged.has(e.id))
    // The period's own note (how notes were written before day notes) is read as written on its last day
    const texts: WeekText[] = [
      ...inputs.notes.map((n) => ({ date: n.date, source: 'note' as const, text: n.note })),
      ...(userNote?.trim() ? [{ date: periodEnd, source: 'note' as const, text: userNote }] : []),
      ...messages,
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
    const readStarted = Date.now()
    const [goal, week] = await Promise.all([
      readGoal(client, inputs.goal, { previous: previousGoal, own, library, weightUnit, deadline }).then((r) => ({ ...r, ms: Date.now() - readStarted })),
      readWeek(client, texts, { own, deadline }).then((r) => ({ ...r, ms: Date.now() - readStarted })),
    ])
    inputs.goalRead = goal.read
    inputs.library = library
    inputs.weekRead = week.read
    if (goal.call) {
      await recordTrace(supabase, {
        userId, feature: 'report', model: GOAL_READER_MODEL, servedModel: goal.call.model, status: goal.call.error ? 'error' : 'ok', error: goal.call.error,
        latencyMs: goal.ms, usage: [goal.call.usage], input: { goal: inputs.goal, prompt: goal.call.prompt }, output: goal.call.error ? undefined : { read: goal.read },
      })
    }
    if (week.call) {
      await recordTrace(supabase, {
        userId, feature: 'report', model: WEEK_READER_MODEL, servedModel: week.call.model, status: week.call.error ? 'error' : 'ok', error: week.call.error,
        latencyMs: week.ms, usage: [week.call.usage], input: { periodStart, periodEnd, prompt: week.call.prompt }, output: week.call.error ? undefined : { read: week.read },
      })
    }

    // Code decides every number and which rules fire; the model writes the headline and advice
    const analysis = analyze(inputs)

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
    // The cause goes to the log only: the row gets a fixed line (saveFailedStatus)
    console.error(
      `Failed to process recommendation for user ${userId} (messageId ${record.messageId}):`,
      err instanceof Error ? err.message : String(err)
    )
    await saveFailedStatus(supabase, request, 'error')
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
