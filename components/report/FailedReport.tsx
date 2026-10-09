'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { retryFailedReport, type ActionResult } from '@/app/(app)/dashboard/period-actions'

// Reports already retried automatically during this visit. A report that fails again
// shows a button instead, so a lasting bug can't loop (each try may call the model).
const autoRetried = new Set<string>()

/** A failed report. Showing it queues it again, once, as if it were still being made;
 *  only a second failure shows the error and a button. The row's error_message holds the
 *  technical cause for debugging; users get a plain message. */
export function FailedReport({ periodStart, onRetried }: { periodStart: string; onRetried: () => void }) {
    const t = useTranslations('report')
    const [retrying, setRetrying] = useState(() => !autoRetried.has(periodStart))
    const [retryError, setRetryError] = useState<string | null>(null)

    const finish = useCallback((result: ActionResult) => {
        if (!result.success) {
            setRetryError(result.message ?? null)
            setRetrying(false)
        }
        // On success the row is 'pending' again; the parent reloads it
        onRetried()
    }, [onRetried])

    useEffect(() => {
        if (autoRetried.has(periodStart)) return
        autoRetried.add(periodStart)
        retryFailedReport(periodStart).then(finish, () => finish({ success: false }))
    }, [periodStart, finish])

    if (retrying) {
        return (
            <div className="flex items-center gap-2 text-sm text-ink/60 dark:text-white/60">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                {t('pending')}
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
