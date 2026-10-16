'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { retryFailedReport, type ActionResult } from '@/app/(app)/dashboard/period-actions'

// Reports already retried automatically during this visit. The server allows one automatic
// retry per report in all (period_reports.retries), so a lasting bug can't loop across visits
// either; after that a failed report shows a button (each try may call the model), until the
// server's limit on retries.
const autoRetried = new Set<string>()

/** A failed report, or one still pending long after it was queued. Showing it queues it again,
 *  once ever, as if it were still being made; after that it shows the error and a button. The
 *  cause is in the worker's log, not the row; users get a plain message. */
export function FailedReport({ periodStart, onRetried }: { periodStart: string; onRetried: () => void }) {
    const t = useTranslations('report')
    const [retrying, setRetrying] = useState(() => !autoRetried.has(periodStart))
    const [retryError, setRetryError] = useState<string | null>(null)
    const [limitReached, setLimitReached] = useState(false)

    const finish = useCallback((result: ActionResult) => {
        if (!result.success) {
            setRetryError(result.message ?? null)
            setRetrying(false)
            // Already retried by itself once: the button, with nothing to reload
            if (result.autoUsed) return
            // Retried as often as it can be: no button, nothing to reload
            if (result.retryLimit) {
                setLimitReached(true)
                return
            }
        }
        // On success the row is 'pending' again; the parent reloads it
        onRetried()
    }, [onRetried])

    useEffect(() => {
        if (autoRetried.has(periodStart)) return
        autoRetried.add(periodStart)
        retryFailedReport(periodStart, { auto: true }).then(finish, () => finish({ success: false }))
    }, [periodStart, finish])

    if (retrying) {
        return (
            <div className="flex items-center gap-2 text-sm text-ink/60 dark:text-white/60">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                {t('pending')}
            </div>
        )
    }

    if (limitReached) {
        return (
            <div className="space-y-2">
                <p className="text-sm text-red-600">{t('failed')}</p>
                <p className="text-sm text-ink/60 dark:text-white/60">{t('retryLimit')}</p>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <p className="text-sm text-red-600">{t('failed')}</p>
            <button
                type="button"
                onClick={() => {
                    setRetrying(true)
                    setRetryError(null)
                    retryFailedReport(periodStart).then(finish, () => finish({ success: false }))
                }}
                className="rounded-md border border-ink/20 px-3 py-1.5 text-sm hover:bg-ink/5"
            >
                {t('retry')}
            </button>
            {retryError && <p className="text-sm text-red-600">{retryError}</p>}
        </div>
    )
}
