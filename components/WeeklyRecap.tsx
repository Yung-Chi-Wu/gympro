'use client'

import { useId, useState, useSyncExternalStore } from 'react'
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

/**
 * Last week, in a popup over Today, once (when, in lib/today-overlay.ts): the days trained, the
 * working sets with a line of the last weeks, and the new bests. Each is held against the week
 * before only when that is good news, since a weekly recap that also says the bad weeks reads as a
 * scolding (Strava's weekly snapshot). The days trained fill in one after another and the line
 * draws from the left; nothing marks a day missed. With reduced motion nothing moves. However it
 * is closed, the week is kept as seen (user_profiles.recap_seen_week).
 */
export function WeeklyRecap({ recap, userId, language, weightUnit }: {
    recap: WeekRecap
    userId: string
    language: string
    weightUnit: WeightUnit
}) {
    const t = useTranslations('recap')
    // The report's own words for its numbers, so the two read the same
    const kpi = useTranslations('reportV3.kpi')
    const { bestText } = useSetWords(weightUnit)
    const titleId = useId()
    const zh = language === 'zh-TW'
    // Closed on the server, as the popup opens only in the browser
    const closedThisVisit = useSyncExternalStore(subscribeNothing, () => {
        try { return sessionStorage.getItem(CLOSED_KEY) === recap.start } catch { return false }
    }, () => true)
    const [closed, setClosed] = useState(false)

    function seen() {
        try { sessionStorage.setItem(CLOSED_KEY, recap.start) } catch {}
        setClosed(true)
        void createClient().from('user_profiles').update({ recap_seen_week: recap.start }).eq('user_id', userId)
            .then(({ error }) => { if (error) reportClientError('client/today/recap-seen', error) })
    }

    if (closedThisVisit || closed) return null
    const { records, weeks } = recap
    const first = records.first

    return (
        <Sheet labelledBy={titleId} onClose={seen} centered>
            <div className="space-y-6">
                <div className="space-y-4 text-center">
                    <div className="space-y-1">
                        <p className="text-[13px] font-semibold text-muted">{t('week', { start: shortDate(recap.start), end: shortDate(recap.end) })}</p>
                        <h2 id={titleId} className="text-[22px] font-bold">
                            {t.rich('trained', { n: recap.trained, num: (c) => <span className="mx-1 font-mono text-[64px] leading-none tabular-nums">{c}</span> })}
                        </h2>
                        {recap.daysNote && (
                            <p className="text-[15px] font-semibold text-good">
                                {recap.daysNote.kind === 'allPlanned' ? t('allPlanned', { planned: recap.daysNote.planned }) : t('moreDays', { n: recap.daysNote.n })}
                            </p>
                        )}
                    </div>

                    {/* The heading says how many; the days are for the eye */}
                    <ol className="mx-auto grid max-w-80 gap-1.5" style={{ gridTemplateColumns: `repeat(${recap.days.length}, minmax(0, 1fr))` }} aria-hidden="true">
                        {recap.days.map((d, i) => (
                            <li key={d.date} className="flex justify-center">
                                <span style={{ animationDelay: `${200 + i * 60}ms` }}
                                    className={`flex size-10 items-center justify-center rounded-full text-sm font-bold motion-safe:animate-pop ${d.trained ? 'bg-accent text-accent-ink' : 'bg-done text-faint'}`}>
                                    {(zh ? WEEKDAYS_ZH : WEEKDAYS_EN)[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>

                {(records.count > 0 || recap.sets > 0 || recap.cardioMinutes > 0) && (
                    <dl className="divide-y divide-line border-y border-line">
                        {recap.sets > 0 ? (
                            <Row label={kpi('sets')} value={recap.sets} unit={kpi('setsUnit')} note={recap.moreSets ? t('moreSets', { n: recap.moreSets }) : null} good>
                                {weeks && (
                                    <WeeksLine weeks={weeks} lastWeek={t('lastWeek')}
                                        label={t('lineLabel', { n: weeks.length, list: weeks.filter((w) => w.sets != null).map((w) => t('weekSets', { date: shortDate(w.start), n: w.sets! })).join(zh ? '、' : ', ') })}
                                        pointLabel={(w) => t('weekSets', { date: shortDate(w.start), n: w.sets! })} />
                                )}
                            </Row>
                        ) : recap.cardioMinutes > 0 && (
                            <Row label={t('cardio')} value={recap.cardioMinutes} unit={t('minutes')} note={null} />
                        )}
                        {first && (
                            <Row label={kpi('records')} value={records.count} unit={kpi('recordsUnit')}
                                note={`${(zh && first.nameZh) || first.name} ${bestText(first.best, first)}${records.count > 1 ? t('recordsMore', { n: records.count - 1 }) : ''}`} />
                        )}
                    </dl>
                )}

                <div className="flex gap-2">
                    {/* Leaving the page takes the popup with it, with no close: it keeps the week as seen itself */}
                    <Link href={`/history?tab=reports&report=${recap.start}`} onClick={seen} className={`${BUTTON.secondary} flex-1`}>{t('fullReport')}</Link>
                    <button className={`${BUTTON.primary} flex-1`}>{t('close')}</button>
                </div>
            </div>
        </Sheet>
    )
}

/** One number of the week, under it what it is or how it beat the week before, and anything that shows it */
function Row({ label, value, unit, note, good, children }: { label: string; value: number; unit: string; note: string | null; good?: boolean; children?: React.ReactNode }) {
    return (
        <div className="py-3.5">
            <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[15px]">{label}</dt>
                <dd className="font-mono text-xl font-bold tabular-nums">
                    {value}{unit && <small className="font-sans text-sm font-medium text-muted"> {unit}</small>}
                </dd>
            </div>
            {note && <dd className={`truncate text-[13px] ${good ? 'font-semibold text-good' : 'text-muted'}`}>{note}</dd>}
            {children && <dd className="pt-3">{children}</dd>}
        </div>
    )
}

// The line's drawing area: the weeks from left to right, the sets from the baseline up, and room
// under the baseline for the weeks' dates and over the top for last week's number
const W = 320
const H = 136
const X0 = 22
const X1 = W - 30
const TOP = 26
const BASE = 106

/**
 * The working sets of the last weeks as one line from zero, last week's point filled and its number
 * over it (Strava's progress chart: points on a line with a faint area under it). A week from before
 * the user's first set has no point, and the line starts at the first that has one. Each point
 * names its week and sets on hover; a screen reader reads them all as the chart's label.
 */
function WeeksLine({ weeks, lastWeek, label, pointLabel }: {
    weeks: NonNullable<WeekRecap['weeks']>
    lastWeek: string
    label: string
    pointLabel: (w: { start: string; sets: number | null }) => string
}) {
    const n = weeks.length
    const max = Math.max(1, ...weeks.map((w) => w.sets ?? 0))
    const x = (i: number) => X0 + (i * (X1 - X0)) / (n - 1)
    const y = (v: number) => BASE - (v / max) * (BASE - TOP)
    const known = weeks.flatMap((w, i) => (w.sets == null ? [] : [{ i, v: w.sets, w }]))
    const line = known.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
    const area = `${line} L${x(known.at(-1)!.i).toFixed(1)},${BASE} L${x(known[0].i).toFixed(1)},${BASE} Z`
    const last = known.at(-1)!
    // The line draws from 300 ms, and each point comes in as the line reaches it
    const reach = (i: number) => `${300 + Math.round((700 * (i - known[0].i)) / Math.max(1, n - 1 - known[0].i))}ms`

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full text-accent" role="img" aria-label={label}>
            <line x1={X0} x2={X1} y1={BASE} y2={BASE} strokeWidth={1} className="stroke-line" />
            <path d={area} fill="currentColor" fillOpacity={0.12} className="motion-safe:animate-fade" style={{ animationDelay: '300ms' }} />
            <path d={line} pathLength={1} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                className="motion-safe:animate-draw motion-safe:[stroke-dasharray:1]" style={{ animationDelay: '300ms' }} />
            {known.map((p) => (
                <circle key={p.w.start} cx={x(p.i)} cy={y(p.v)} r={p === last ? 5 : 4} strokeWidth={2}
                    className={`origin-center [transform-box:fill-box] motion-safe:animate-pop ${p === last ? 'fill-current stroke-current' : 'fill-raised stroke-current'}`}
                    style={{ animationDelay: reach(p.i) }}>
                    <title>{pointLabel(p.w)}</title>
                </circle>
            ))}
            <text x={x(last.i)} y={y(last.v) - 12} textAnchor="middle" className="fill-ink font-mono text-[13px] font-bold motion-safe:animate-fade" style={{ animationDelay: reach(last.i) }}>{last.v}</text>
            {weeks.map((w, i) => (
                <text key={w.start} x={x(i)} y={H - 8} textAnchor="middle" className={`text-xs ${i === n - 1 ? 'fill-ink font-semibold' : 'fill-muted'}`}>
                    {i === n - 1 ? lastWeek : shortDate(w.start)}
                </text>
            ))}
        </svg>
    )
}
