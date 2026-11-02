import type { LatestReport } from '@/lib/report/latest'
import type { RecordFacts, ReportFacts } from '@/lib/report/types'

/** Last week in a few numbers, as the recap says them (components/WeeklyRecap.tsx) */
export interface WeekRecap {
    start: string
    end: string
    days: { date: string; trained: boolean }[]
    trained: number
    /** What the days trained are held against, said only when it is good news: every planned day done, or more days than the week before */
    daysNote: { kind: 'allPlanned'; planned: number } | { kind: 'more'; n: number } | null
    records: { count: number; first: RecordFacts | null }
    sets: number
    /** How many more working sets than the week before; null when there weren't more */
    moreSets: number | null
    /** Cardio minutes, said in place of the sets in a week of cardio only */
    cardioMinutes: number
}

/** What Today opens over the page on this visit */
export type TodayOverlay = { kind: 'recap'; recap: WeekRecap } | null

/**
 * At most one thing opens over Today on a visit, so two never stack: onboarding first
 * (OnboardingGuard), then last week's recap, then the daily reminder's card (ReminderNotice),
 * which waits for a visit with nothing else.
 *
 * The recap (owner, 2026-11-02) is of the week that just ended, once its report is done and the
 * week had training in it. It opens once a week: closing it on any device keeps the week
 * (user_profiles.recap_seen_week). A late report's recap opens when it is ready, on any day of
 * the week, and never a week late. Not once today is logged: the user is in the middle of a
 * workout.
 */
export function dueOverlay({ onboarded, latest, lastPeriod, recapSeenWeek, loggedToday }: {
    onboarded: boolean
    latest: LatestReport | null
    lastPeriod: { start: string } | null
    recapSeenWeek: string | null
    loggedToday: boolean
}): TodayOverlay {
    if (!onboarded || loggedToday || !latest || !lastPeriod) return null
    if (latest.periodStart !== lastPeriod.start || recapSeenWeek === lastPeriod.start) return null
    if (latest.status !== 'completed' && latest.status !== 'insufficient_data') return null
    const facts = (latest.recommendation as { version?: unknown; facts?: ReportFacts } | null)?.facts
    if (!facts?.sessions || facts.sessions.done === 0) return null
    return { kind: 'recap', recap: recapOf(facts) }
}

function recapOf(facts: ReportFacts): WeekRecap {
    const { sessions, totalSets } = facts
    const planned = sessions.planned ?? 0
    const before = sessions.previousDone
    return {
        start: facts.period.start,
        end: facts.period.end,
        days: sessions.days.map((d) => ({ date: d.date, trained: d.trained })),
        trained: sessions.done,
        daysNote: planned > 0 && sessions.done >= planned ? { kind: 'allPlanned', planned }
            : before != null && sessions.done > before ? { kind: 'more', n: sessions.done - before } : null,
        records: { count: facts.records.length, first: facts.records[0] ?? null },
        sets: totalSets.now,
        moreSets: totalSets.previous != null && totalSets.now > totalSets.previous ? totalSets.now - totalSets.previous : null,
        cardioMinutes: Math.round(facts.cardio?.minutes ?? 0),
    }
}
