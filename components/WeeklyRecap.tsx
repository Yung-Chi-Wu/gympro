'use client'

import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { reportClientError } from '@/lib/report-client-error'
import type { WeekRecap } from '@/lib/today-overlay'
import type { WeightUnit } from '@/lib/weight-unit'
import { BUTTON } from '@/lib/ui'
import { Sheet } from './Sheet'
import { shortDate, useSetWords } from './report/ReportView'

/** The week of the recap closed on this visit: a save that failed doesn't open it again before the next */
const CLOSED_KEY = 'recap_closed'

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAYS_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// sessionStorage doesn't announce changes in this tab; it is read when the recap renders
const subscribeNothing = () => () => {}

/** Once the popup is open the days trained fill in one after another, the number counting with them; the rest comes in after (ms) */
const FILL_START = 300
const FILL_STEP = 160
/** After the days: the weeks' bars one after another, and while they grow each line under them */
const BAR_STEP = 50
const LINES_AFTER = 300
const LINE_STEP = 100

/** The days filled in so far, one more every FILL_STEP; all of them at once with reduced motion */
function useFilled(trained: number) {
    const [filled, setFilled] = useState(() => (typeof window === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches ? trained : 0))
    useEffect(() => {
        if (filled >= trained) return
        const id = setTimeout(() => setFilled(filled + 1), filled ? FILL_STEP : FILL_START)
        return () => clearTimeout(id)
    }, [filled, trained])
    return filled
}

/**
 * Last week, in a popup over Today, once (when, in lib/today-overlay.ts): a short show of what the
 * user did, that takes them to the full report, as some never open it themselves (owner,
 * 2026-11-03). It says what covers the whole week, never a few of its lifts: the days trained, the
 * days trained of each of the last weeks, every new best, and the cardio and body groups trained.
 * The days are held against the week before only when that is good news, since a weekly recap that
 * also says the bad weeks reads as a scolding (Strava's weekly snapshot). The days fill in one after
 * another as the number counts, the weeks' bars grow and the lines come in; nothing marks a day
 * missed. With reduced motion nothing moves. However it is closed, the week is kept as seen
 * (user_profiles.recap_seen_week).
 */
export function WeeklyRecap({ recap, userId, language, weightUnit }: {
    recap: WeekRecap
    userId: string
    language: string
    weightUnit: WeightUnit
}) {
    const t = useTranslations('recap')
    // The report's own words, so the two read the same
    const kpi = useTranslations('reportV3.kpi')
    const group = useTranslations('reportV3.share.group')
    const { bestText } = useSetWords(weightUnit)
    const titleId = useId()
    const zh = language === 'zh-TW'
    // Closed on the server, as the popup opens only in the browser
    const closedThisVisit = useSyncExternalStore(subscribeNothing, () => {
        try { return sessionStorage.getItem(CLOSED_KEY) === recap.start } catch { return false }
    }, () => true)
    const [closed, setClosed] = useState(false)
    const filled = useFilled(recap.trained)

    function seen() {
        try { sessionStorage.setItem(CLOSED_KEY, recap.start) } catch {}
        setClosed(true)
        void createClient().from('user_profiles').update({ recap_seen_week: recap.start }).eq('user_id', userId)
            .then(({ error }) => { if (error) reportClientError('client/today/recap-seen', error) })
    }

    if (closedThisVisit || closed) return null
    const { records, weeks } = recap
    const sep = zh ? '、' : ', '
    const daysEnd = FILL_START + recap.trained * FILL_STEP
    const linesFrom = daysEnd + LINES_AFTER
    let line = 0
    const nextLine = () => ({ animationDelay: `${linesFrom + line++ * LINE_STEP}ms` })
    let rank = 0

    return (
        <Sheet labelledBy={titleId} onClose={seen} centered>
            <div className="space-y-6">
                <div className="space-y-4 text-center">
                    <div className="space-y-1">
                        <p className="text-[13px] font-semibold text-muted">{t('week', { start: shortDate(recap.start), end: shortDate(recap.end) })}</p>
                        <h2 id={titleId} className="text-[22px] font-bold">
                            <span className="sr-only">{t.rich('trained', { n: recap.trained, num: (c) => c })}</span>
                            {/* Counts up with the days below */}
                            <span aria-hidden="true">{t.rich('trained', { n: filled, num: (c) => <span className="mx-1 font-mono text-[64px] leading-none tabular-nums">{c}</span> })}</span>
                        </h2>
                        {recap.daysNote && (
                            <p className="text-[15px] font-semibold text-good motion-safe:animate-rise" style={{ animationDelay: `${daysEnd}ms` }}>
                                {recap.daysNote.kind === 'allPlanned' ? t('allPlanned', { planned: recap.daysNote.planned }) : t('moreDays', { n: recap.daysNote.n })}
                            </p>
                        )}
                    </div>

                    {/* The heading says how many; the days are for the eye */}
                    <ol className="mx-auto grid max-w-80 gap-1.5" style={{ gridTemplateColumns: `repeat(${recap.days.length}, minmax(0, 1fr))` }} aria-hidden="true">
                        {recap.days.map((d) => {
                            const on = d.trained && rank++ < filled
                            return (
                                <li key={d.date} className="flex justify-center">
                                    <span className={`flex size-10 items-center justify-center rounded-full text-sm font-bold ${on ? 'bg-accent text-accent-ink motion-safe:animate-fill' : 'bg-done text-faint'}`}>
                                        {(zh ? WEEKDAYS_ZH : WEEKDAYS_EN)[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}
                                    </span>
                                </li>
                            )
                        })}
                    </ol>
                </div>

                {weeks && (
                    <WeeksBars weeks={weeks} start={daysEnd} title={t('recentWeeks', { n: weeks.length })} lastWeek={t('lastWeek')}
                        trained={t('weeksTrained', { n: weeks.filter((w) => (w.days ?? 0) > 0).length })}
                        label={t('chartLabel', { n: weeks.length, list: weeks.filter((w) => w.days != null).map((w) => t('weekDays', { date: shortDate(w.start), n: w.days! })).join(sep) })} />
                )}

                {(records.count > 0 || recap.cardioMinutes > 0 || recap.groups.length > 0) && (
                    <dl className="divide-y divide-line border-y border-line">
                        {records.count > 0 && (
                            <div className="space-y-1.5 py-3.5 motion-safe:animate-rise" style={nextLine()}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-[15px]">{kpi('records')}</dt>
                                    <dd className="font-mono text-xl font-bold tabular-nums">
                                        {records.count}{kpi('recordsUnit') && <small className="font-sans text-sm font-medium text-muted"> {kpi('recordsUnit')}</small>}
                                    </dd>
                                </div>
                                {records.named.map((r) => (
                                    <dd key={r.exerciseId} className="flex items-baseline justify-between gap-3 text-[13px]">
                                        <span className="min-w-0 truncate">{(zh && r.nameZh) || r.name}</span>
                                        <span className="shrink-0 font-mono tabular-nums text-muted">{bestText(r.best, r)}</span>
                                    </dd>
                                ))}
                                {records.count > records.named.length && <dd className="text-[13px] text-muted">{t('moreRecords', { n: records.count - records.named.length })}</dd>}
                            </div>
                        )}
                        {recap.cardioMinutes > 0 && (
                            <div className="flex items-baseline justify-between gap-3 py-3.5 motion-safe:animate-rise" style={nextLine()}>
                                <dt className="text-[15px]">{t('cardio')}</dt>
                                <dd className="font-mono text-xl font-bold tabular-nums">
                                    {recap.cardioMinutes}<small className="font-sans text-sm font-medium text-muted"> {t('minutes')}</small>
                                </dd>
                            </div>
                        )}
                        {recap.groups.length > 0 && (
                            <div className="flex items-baseline justify-between gap-3 py-3.5 motion-safe:animate-rise" style={nextLine()}>
                                <dt className="shrink-0 text-[15px]">{t('trainedParts')}</dt>
                                <dd className="min-w-0 text-right text-[15px] font-semibold">{recap.groups.map((g) => group(g)).join(sep)}</dd>
                            </div>
                        )}
                    </dl>
                )}

                <div className="space-y-3">
                    {recap.advice > 0 && <p className="text-center text-[13px] text-muted">{t('advice', { n: recap.advice })}</p>}
                    {/* The report is what the popup is for (owner, 2026-11-03) */}
                    <div className="flex gap-2">
                        <button className={`${BUTTON.secondary} flex-1`}>{t('close')}</button>
                        {/* Leaving the page takes the popup with it, with no close: it keeps the week as seen itself */}
                        <Link href={`/history?tab=reports&report=${recap.start}`} onClick={seen} className={`${BUTTON.primary} flex-1`}>{t('fullReport')}</Link>
                    </div>
                </div>
            </div>
        </Sheet>
    )
}

/** Bar height in pixels for 7 days: the scale is the week's, so a bar means the same every week */
const FULL_WEEK_PX = 72

/**
 * The days trained of each of the last weeks as bars on one scale of 0 to 7 days, the number over
 * each and last week's in the accent (Strong's workouts per week, Hevy's weekly hours: one bar a
 * week for a count). A week from before the user's first set has no bar; a week off has a stub at 0.
 * A screen reader reads every week as the chart's label.
 */
function WeeksBars({ weeks, start, title, trained, lastWeek, label }: {
    weeks: NonNullable<WeekRecap['weeks']>
    /** When the first bar grows, in ms */
    start: number
    title: string
    trained: string
    lastWeek: string
    label: string
}) {
    const last = weeks.length - 1
    return (
        <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[15px]">{title}</h3>
                <p className="text-[15px] font-semibold">{trained}</p>
            </div>
            <div role="img" aria-label={label}>
                <ol className="grid items-end gap-2" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }} aria-hidden="true">
                    {weeks.map((w, i) => (
                        <li key={w.start} className="flex flex-col items-center gap-1.5">
                            {/* The number sits on its bar; the box is as tall as a full week's bar and its number */}
                            <span className="flex w-full flex-col items-center justify-end gap-1" style={{ height: FULL_WEEK_PX + 20 }}>
                                {w.days != null && (
                                    <>
                                        <span className={`font-mono text-[13px] font-bold tabular-nums motion-safe:animate-rise ${i === last ? 'text-ink' : 'text-muted'}`}
                                            style={{ animationDelay: `${start + i * BAR_STEP + 200}ms` }}>{w.days}</span>
                                        <span style={{ height: Math.max(3, (w.days / 7) * FULL_WEEK_PX), animationDelay: `${start + i * BAR_STEP}ms` }}
                                            className={`w-full max-w-9 origin-bottom rounded-md motion-safe:animate-grow ${w.days === 0 ? 'bg-line' : i === last ? 'bg-accent' : 'bg-accent/35'}`} />
                                    </>
                                )}
                            </span>
                            <span className={`whitespace-nowrap text-xs ${i === last ? 'font-semibold text-ink' : 'text-muted'}`}>{i === last ? lastWeek : shortDate(w.start)}</span>
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    )
}
