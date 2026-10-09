'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { retryFailedReport } from '@/app/(app)/dashboard/period-actions'

/** A failed report, with a button that queues it again. The row's error_message holds the
 *  technical cause for debugging; users get a plain message. */
export function FailedReport({ periodStart, onRetried }: { periodStart: string; onRetried: () => void }) {
    const t = useTranslations('report')
    const [retrying, setRetrying] = useState(false)
    const [retryError, setRetryError] = useState<string | null>(null)

    async function handleRetry() {
        setRetrying(true)
        setRetryError(null)
        const result = await retryFailedReport(periodStart)
        setRetrying(false)
        if (!result.success) setRetryError(result.message ?? null)
        // On success the row is 'pending' again; the parent reloads it
        onRetried()
    }

    return (
        <div className="space-y-2">
            <p className="text-sm text-red-600">{t('failed')}</p>
            <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="rounded-md border border-ink/20 px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-50"
            >
                {retrying ? t('retrying') : t('retry')}
            </button>
            {retryError && <p className="text-sm text-red-600">{retryError}</p>}
        </div>
    )
}
