import { errorMessageOf } from './app-errors'

// Failures in the browser: a save a client component makes straight to Supabase, or a call to
// one of the app's routes, that failed in front of the user. Sent to POST /api/errors, which
// keeps them in app_errors like the server's own (lib/app-errors.ts), so they alarm too. Only
// the error's own message is sent, never what the user typed. Phones lose signal all the time,
// which is not a bug, so a request that never reached the server is not reported; and one page
// load sends each failure once, and only a few in all.

/** What a report may hold; the route checks it again (parseClientErrorReport) */
export const CLIENT_SOURCE_PATTERN = /^client\/[a-z0-9][a-z0-9/_-]{0,60}$/
export const MAX_CLIENT_MESSAGE_CHARS = 500
export const MAX_CLIENT_CONTEXT_KEYS = 5
export const MAX_CLIENT_CONTEXT_VALUE_CHARS = 100
/** One page load sends at most this many, so a failure in a loop can't flood the table */
export const MAX_REPORTS_PER_PAGE = 10

/**
 * How browsers say a request never reached the server: Chrome, Safari (and every browser on
 * iOS), Firefox, Safari offline and on a dropped connection; and a request aborted, by the user
 * or a timeout. A message counts when it starts with one of these, after an error name such as
 * "TypeError: ", which is how Supabase passes them on.
 */
export const NETWORK_FAILURES = [
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource',
    'The Internet connection appears to be offline',
    'The network connection was lost',
    'AbortError',
] as const

export type ClientErrorContext = Record<string, string | number | boolean>

export interface ClientErrorReport {
    source: string
    message: string
    context?: ClientErrorContext
}

/** Whether the request never reached the server (NETWORK_FAILURES) */
export function isNetworkFailure(err: unknown): boolean {
    if (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError') return true
    const message = errorMessageOf(err).toLowerCase()
    const withoutName = message.replace(/^\w+: /, '')
    return NETWORK_FAILURES.some((m) => message.startsWith(m.toLowerCase()) || withoutName.startsWith(m.toLowerCase()))
}

/** The body of POST /api/errors, checked whole: null when anything in it is off */
export function parseClientErrorReport(body: unknown): ClientErrorReport | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const { source, message, context } = body as Record<string, unknown>
    if (typeof source !== 'string' || !CLIENT_SOURCE_PATTERN.test(source)) return null
    if (typeof message !== 'string') return null
    const report: ClientErrorReport = { source, message: message.slice(0, MAX_CLIENT_MESSAGE_CHARS) }
    if (context === undefined) return report

    if (typeof context !== 'object' || context === null || Array.isArray(context)) return null
    const facts = Object.entries(context)
    if (facts.length > MAX_CLIENT_CONTEXT_KEYS) return null
    if (!facts.every(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) return null
    report.context = Object.fromEntries(facts.map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, MAX_CLIENT_CONTEXT_VALUE_CHARS) : v]))
    return report
}

// Answers from the app's routes that are not the browser's to report (responseError)
const notReported = new WeakSet<object>()
// What this page load has sent, as source and message
const sent = new Set<string>()

/**
 * The error for an app route's answer that isn't what was asked for, for the caller to throw
 * or report. It is reported only when the route couldn't report it itself: a 2xx without what
 * was asked for, or a 5xx that isn't the route's own JSON error (a timeout, a crash). A route's
 * own error answer is kept on the server already (reportError, or ai_traces for an AI call,
 * whose alarms let one blip pass), and a 4xx is the request's own: signed out, a message too
 * long, an answer the route refused, a card already resolved.
 */
export function responseError(message: string, status: number, body: unknown): Error {
    const err = new Error(message)
    const routeAnswered = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    if ((status >= 400 && status < 500) || (status >= 500 && routeAnswered)) notReported.add(err)
    return err
}

/**
 * Reports a failure in the browser to app_errors. It never throws and needs no await: the
 * report goes out on its own, and a report that can't be sent is dropped. An Error thrown with
 * a cause (a friendly message over the Supabase error) is reported by its cause, which says
 * what failed. Not reported: a request that never reached the server (isNetworkFailure, or the
 * browser offline), an answer responseError keeps back, a failure this page load already sent,
 * and anything past MAX_REPORTS_PER_PAGE.
 */
export function reportClientError(source: string, err: unknown, context?: ClientErrorContext): void {
    try {
        if (typeof err === 'object' && err !== null && notReported.has(err)) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return
        const failure = err instanceof Error && err.cause != null ? err.cause : err
        if (isNetworkFailure(failure)) return

        const message = errorMessageOf(failure).slice(0, MAX_CLIENT_MESSAGE_CHARS)
        const key = `${source}\n${message}`
        if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE) return
        sent.add(key)

        const facts = context && Object.entries(context).slice(0, MAX_CLIENT_CONTEXT_KEYS)
            .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, MAX_CLIENT_CONTEXT_VALUE_CHARS) : v])
        fetch('/api/errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, message, ...(facts?.length ? { context: Object.fromEntries(facts) } : {}) }),
            // Sent even when the page is closing
            keepalive: true,
        }).catch(() => {})
    } catch {
        // Reporting must never break what already failed
    }
}
