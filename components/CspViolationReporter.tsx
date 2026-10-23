'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-client-error'

// What the Content-Security-Policy (next.config.ts) blocks in a signed-in page, kept in app_errors
// so it alarms: a host or inline script the app needs but the policy leaves out would otherwise
// break a feature with nothing but a line in the browser's console. Only where it came from is
// sent: the blocked address and the script that tried it, as origin and path without the query,
// and the page's path. A browser extension's own blocked loads are not the app's, so not sent.
// Renders nothing.

const EXTENSION = /^(chrome|moz|safari-web|safari)-extension:/

/** An address as origin and path, or the keyword the browser gives (inline, eval, data) */
function where(uri: string): string {
    try {
        const url = new URL(uri)
        return url.origin === 'null' ? url.protocol : `${url.origin}${url.pathname}`
    } catch {
        return uri.slice(0, 60)
    }
}

export function CspViolationReporter() {
    useEffect(() => {
        const onViolation = (e: SecurityPolicyViolationEvent) => {
            if (EXTENSION.test(e.blockedURI) || EXTENSION.test(e.sourceFile)) return
            reportClientError('client/csp', new Error(`${e.effectiveDirective} blocked ${where(e.blockedURI) || 'inline'}`), {
                page: location.pathname,
                // "report" while the policy is report-only, "enforce" once it blocks
                disposition: e.disposition,
                ...(e.sourceFile ? { from: where(e.sourceFile) } : {}),
            })
        }
        document.addEventListener('securitypolicyviolation', onViolation)
        return () => document.removeEventListener('securitypolicyviolation', onViolation)
    }, [])

    return null
}
