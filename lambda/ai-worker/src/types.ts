// The SQS message that asks for one period's report (sent by the scheduler and the app's retry)
export interface AnalysisRequestMessage {
  userId: string
  periodStart: string
  periodEnd: string
  userNote?: string
  language?: string
  /** The row's queued_at when this request was queued; the worker runs only while the row still has it (lib/report/queue.ts) */
  queuedAt?: string
}
