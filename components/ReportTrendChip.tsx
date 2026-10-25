'use client'

import { useTranslations } from 'next-intl'
import type { PeriodReportStatus } from '@/lib/history'

/** A period's report in a word: being made, or its verdict. Nothing when there is none yet. */
export function ReportTrendChip({ report }: { report: PeriodReportStatus | null }) {
    const t = useTranslations('history')
    const tV3 = useTranslations('reportV3')
    if (!report) return null
    if (report.status === 'pending') return <span className="whitespace-nowrap rounded-full bg-done px-2 text-[13px] text-muted md:text-xs">{t('reportPending')}</span>
    if (!report.trend) return null
    const tone = report.trend === 'progressing'
        ? 'bg-good-soft text-good'
        : report.trend === 'regressing' ? 'bg-accent-soft text-miss' : 'bg-done text-muted'
    return (
        <span className={`whitespace-nowrap rounded-full px-2 text-[13px] font-medium md:text-xs ${tone}`}>
            {t('reportTrend', { trend: tV3(`status.${report.trend}`) })}
        </span>
    )
}
