// The SQS message that asks for one period's report (sent by the scheduler and the app's retry)
export interface AnalysisRequestMessage {
  userId: string
  periodStart: string
  periodEnd: string
  userNote?: string
  language?: string
}
