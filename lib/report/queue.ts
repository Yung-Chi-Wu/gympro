// A report request's life in the queue (period_reports.queued_at), shared by the app and the
// report worker. The SQS message carries the row's queued_at; the worker runs a message only
// while the row is pending with that same value, so each request runs once.

/**
 * A report still pending this long after it was queued isn't coming: its run died (a Lambda
 * crash, or the queue gave up on it). Longer than SQS takes to redeliver a message twice
 * (visibility timeout 12 minutes), which picks a crashed run up again by itself.
 * claim_report_retry (migration 20261014120000) uses the same 30 minutes.
 */
export const STALE_PENDING_MS = 30 * 60_000

export const isStalePending = (r: { status: string; queued_at?: string | null }, now = Date.now()) =>
    r.status === 'pending' && !!r.queued_at && now - Date.parse(r.queued_at) > STALE_PENDING_MS

/** The status the app shows: a pending report that isn't coming shows as failed, with its retry */
export const shownStatus = (r: { status: string; queued_at?: string | null }, now = Date.now()) =>
    isStalePending(r, now) ? 'failed' : r.status

/** Whether a message is the row's current request: an older one was replaced by a retry */
export const isCurrentRequest = (rowQueuedAt: string | null | undefined, messageQueuedAt: string) =>
    rowQueuedAt != null && Date.parse(rowQueuedAt) === Date.parse(messageQueuedAt)
