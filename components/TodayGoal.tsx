'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { unitLabel } from '@/lib/report/volume'
import type { LatestReport } from '@/lib/report/latest'
import type { WeightUnit } from '@/lib/weight-unit'
import { GoalSection, isReportV3 } from './report/ReportView'

/** Settings, open at the goal */
export const GOAL_SETTING = '/settings?item=trainingGoal'

/**
 * The goal, first on Today: some users didn't know to set one (owner, 2026-10-28).
 * - A goal the newest report has read: its rows, as the report shows them. They link to that
 *   report, and Today's report card leaves them out.
 * - A goal no report has read yet (just set or changed): the goal in its own words.
 * - No goal: one quiet line to set it. Nothing else asks, no banner and no notification.
 */
export function TodayGoal({ goal, latest, language, weightUnit }: {
    goal: string | null
    latest: LatestReport | null
    language: string
    weightUnit: WeightUnit
}) {
    const t = useTranslations('dashboard')
    const text = goal?.trim() ?? ''

    if (!text) {
        return (
            <Link href={GOAL_SETTING}
                className="flex min-h-11 items-center justify-between gap-3 rounded-card bg-done px-4 py-3 text-[15px] text-muted transition-colors hover:bg-line md:text-sm">
                <span>{t('goalPrompt')}</span>
                <span className="whitespace-nowrap font-semibold text-accent">{t('goalSet')} <span aria-hidden="true">›</span></span>
            </Link>
        )
    }

    const report = latest?.status === 'completed' && isReportV3(latest.recommendation) ? latest.recommendation : null
    const read = report?.facts.goal.read
    if (report && latest && read?.model && read.text === text && report.facts.goal.progress?.length) {
        return (
            <Link href={`/history?tab=reports&report=${latest.periodStart}`}
                className="block rounded-card border border-line bg-card p-4 transition-colors hover:border-ink/20">
                <GoalSection goal={report.facts.goal} unit={report.facts.period.days === 7 ? 'week' : 'cycle'} zh={language === 'zh-TW'}
                    weightUnit={weightUnit} summary muscle={(g) => unitLabel(g, language, (x) => getMuscleGroupLabel(x, language))} />
            </Link>
        )
    }

    return (
        <Link href={GOAL_SETTING} aria-label={t('goalEdit', { goal: text })}
            className="flex min-h-11 items-center gap-2 rounded-card border border-line bg-card px-4 py-3 text-[15px] transition-colors hover:border-ink/20 md:text-sm">
            <b className="font-semibold">{t('goalLabel')}</b>
            <span className="min-w-0 flex-1 truncate text-muted">{text}</span>
            <span aria-hidden="true" className="text-faint">›</span>
        </Link>
    )
}
