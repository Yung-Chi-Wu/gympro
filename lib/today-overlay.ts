import { TIERS, type AwardId, type AwardTrack, type Tier } from '@/lib/awards'
import { addDays } from '@/lib/periods'
import type { LatestReport } from '@/lib/report/latest'
import { adviceItems, type RecordFacts, type ReportFacts, type ReportV3 } from '@/lib/report/types'
import type { BodyGroup } from '@/lib/report/volume'

/** The new bests the recap names, the rest counted */
export const RECAP_RECORDS = 3

/** Last week, as the recap says it (components/WeeklyRecap.tsx): what covers all of it, never a few of its lifts, and what the report holds for the week ahead */
export interface WeekRecap {
    start: string
    end: string
    days: { date: string; trained: boolean }[]
    trained: number
    /** What the days trained are held against, said only when it is good news: every planned day done, or more days than the week before */
    daysNote: { kind: 'allPlanned'; planned: number } | { kind: 'more'; n: number } | null
    /** The days trained in each of the last weeks, oldest first, each with its first day: null before the user's first set, and all of it null with fewer than two weeks to show or in a report saved before it kept them */
    weeks: { start: string; days: number | null }[] | null
    /** Every new best, the first RECAP_RECORDS named */
    records: { count: number; named: RecordFacts[] }
    /** The body groups trained, in the report's order */
    groups: BodyGroup[]
    cardioMinutes: number
    /** The report's advice for the week ahead, counted: none in a week of a few sets (stats only) */
    advice: number
}

/** A medal reached since the user's medals were last checked: the highest of its award, its mark, and the next one (null after gold) */
export interface NewMedal {
    id: AwardId
    tier: Tier
    mark: number
    next: { tier: Tier; mark: number } | null
    date: string
}

/** What a check for medals found, and the last day it covers (yesterday), kept as checked once they are seen */
export interface MedalCheck {
    medals: NewMedal[]
    through: string
}

/** What Today opens over the page on this visit */
export type TodayOverlay = ({ kind: 'medals' } & MedalCheck) | { kind: 'recap'; recap: WeekRecap } | null

/**
 * Whether this visit checks for new medals (lib/awards.ts works them out from the whole log, so
 * Today reads it only then): once a day, as a medal opens the day after it is reached.
 * awardsSeen is the last day checked (user_profiles.awards_seen_date); null for an account made
 * since the column, whose every medal is new.
 */
export const medalsToCheck = ({ onboarded, awardsSeen, today }: { onboarded: boolean; awardsSeen: string | null; today: string }) =>
    onboarded && (awardsSeen === null || awardsSeen < addDays(today, -1))

/** The medals reached after the last day checked and before today, the highest of each award, in the awards' order */
export function newMedals(tracks: AwardTrack[], { awardsSeen, today }: { awardsSeen: string | null; today: string }): MedalCheck {
    const medals: NewMedal[] = []
    for (const track of tracks) {
        let top: NewMedal | null = null
        for (let i = 0; i < TIERS.length; i++) {
            const date = track.reached[i]
            const next = i + 1 < TIERS.length ? { tier: TIERS[i + 1], mark: track.tiers[i + 1] } : null
            if (date && (awardsSeen === null || date > awardsSeen) && date < today) top = { id: track.id, tier: TIERS[i], mark: track.tiers[i], next, date }
        }
        if (top) medals.push(top)
    }
    return { medals, through: addDays(today, -1) }
}

/**
 * At most one thing opens over Today on a visit, so two never stack: onboarding first
 * (OnboardingGuard), then new medals, then last week's recap, then the daily reminder's card
 * (ReminderNotice), which waits for a visit with nothing else. Neither the medals nor the recap
 * opens once today is logged: the user is in the middle of a workout.
 *
 * New medals (owner, 2026-11-03) open the day after they are reached, on the first visit, all of
 * them in one popup; closing it keeps the days up to yesterday as checked (awards_seen_date), on
 * any device. The recap waits for the next visit: it opens on any day of its week.
 *
 * The recap (owner, 2026-11-02) is of the week that just ended, once its report is done and the
 * week had training in it. It opens once a week: closing it on any device keeps the week
 * (user_profiles.recap_seen_week). A late report's recap opens when it is ready, on any day of
 * the week, and never a week late.
 */
export function dueOverlay({ onboarded, latest, lastPeriod, recapSeenWeek, loggedToday, medals }: {
    onboarded: boolean
    latest: LatestReport | null
    lastPeriod: { start: string } | null
    recapSeenWeek: string | null
    loggedToday: boolean
    /** Null when this visit didn't check (medalsToCheck) */
    medals: MedalCheck | null
}): TodayOverlay {
    if (!onboarded || loggedToday) return null
    if (medals?.medals.length) return { kind: 'medals', ...medals }
    if (!latest || !lastPeriod) return null
    if (latest.periodStart !== lastPeriod.start || recapSeenWeek === lastPeriod.start) return null
    if (latest.status !== 'completed' && latest.status !== 'insufficient_data') return null
    // A week of a few sets has its facts alone (ReportStats), with no findings or narrative
    const rec = latest.recommendation as Partial<ReportV3> | null
    const facts = rec?.facts
    if (!facts?.sessions || facts.sessions.done === 0) return null
    const advice = rec?.narrative && rec.findings ? adviceItems({ narrative: rec.narrative, findings: rec.findings }).length : 0
    return { kind: 'recap', recap: recapOf(facts, advice) }
}

function recapOf(facts: ReportFacts, advice: number): WeekRecap {
    const { sessions } = facts
    const planned = sessions.planned ?? 0
    const before = sessions.previousDone
    const series = sessions.series
    return {
        start: facts.period.start,
        end: facts.period.end,
        days: sessions.days.map((d) => ({ date: d.date, trained: d.trained })),
        trained: sessions.done,
        daysNote: planned > 0 && sessions.done >= planned ? { kind: 'allPlanned', planned }
            : before != null && sessions.done > before ? { kind: 'more', n: sessions.done - before } : null,
        weeks: series && series.filter((n) => n != null).length >= 2
            ? series.map((days, i) => ({ start: addDays(facts.period.start, -(series.length - 1 - i) * facts.period.days), days }))
            : null,
        records: { count: facts.records.length, named: facts.records.slice(0, RECAP_RECORDS) },
        groups: (facts.groups ?? []).filter((g) => g.sets > 0).map((g) => g.group),
        cardioMinutes: Math.round(facts.cardio?.minutes ?? 0),
        advice,
    }
}
