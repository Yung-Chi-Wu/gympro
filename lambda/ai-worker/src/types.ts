// The SQS message that asks for one period's report (sent by the scheduler and the app's retry).
// It names the row and the request; the worker reads the period and the note from the row
// itself, and the language from the profile, so nothing in a message is taken on trust.
export interface AnalysisRequestMessage {
  userId: string
  periodStart: string
  /** The row's queued_at when this request was queued; the worker runs only while the row still has it (lib/report/queue.ts) */
  queuedAt: string
}
