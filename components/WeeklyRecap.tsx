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
 * Last week, over Today, once (when, in lib/today-overlay.ts): the days trained, the new bests and
 * the sets, each held against the week before only when that is good news, since a weekly recap
 * that also says the bad weeks reads as a scolding (Strava's weekly snapshot). The days trained
 * fill in one after another; nothing marks a day missed. With reduced motion nothing moves.
 * However it is closed, the week is kept as seen (user_profiles.recap_seen_week).
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
    // Closed on the server, as the sheet opens only in the browser
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
    const { records } = recap
    const first = records.first

    return (
        <Sheet labelledBy={titleId} onClose={seen}>
            <div className="space-y-5">
                <div className="space-y-1">
                    <p className="text-[13px] font-semibold text-muted md:text-xs">{t('week', { start: shortDate(recap.start), end: shortDate(recap.end) })}</p>
                    <h2 id={titleId} className="text-xl font-bold">
                        {t.rich('trained', { n: recap.trained, num: (c) => <span className="font-mono text-[40px] leading-none tabular-nums">{c}</span> })}
                    </h2>
                    {recap.daysNote && (
                        <p className="text-[15px] font-semibold text-good md:text-sm">
                            {recap.daysNote.kind === 'allPlanned' ? t('allPlanned', { planned: recap.daysNote.planned }) : t('moreDays', { n: recap.daysNote.n })}
                        </p>
                    )}
                </div>

                {/* The heading says how many; the days are for the eye */}
                <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${recap.days.length}, minmax(0, 1fr))` }} aria-hidden="true">
                    {recap.days.map((d, i) => (
                        <li key={d.date} className="flex justify-center">
                            <span style={{ animationDelay: `${150 + i * 60}ms` }}
                                className={`flex size-9 items-center justify-center rounded-full text-[13px] font-bold motion-safe:animate-pop ${d.trained ? 'bg-accent text-accent-ink' : 'bg-done text-faint'}`}>
                                {(zh ? WEEKDAYS_ZH : WEEKDAYS_EN)[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}
                            </span>
                        </li>
                    ))}
                </ol>

                {(records.count > 0 || recap.sets > 0 || recap.cardioMinutes > 0) && (
                    <dl className="divide-y divide-line border-y border-line">
                        {first && (
                            <Row label={kpi('records')} value={records.count} unit={kpi('recordsUnit')}
                                note={`${(zh && first.nameZh) || first.name} ${bestText(first.best, first)}${records.count > 1 ? t('recordsMore', { n: records.count - 1 }) : ''}`} />
                        )}
                        {recap.sets > 0 ? (
                            <Row label={kpi('sets')} value={recap.sets} unit={kpi('setsUnit')} note={recap.moreSets ? t('moreSets', { n: recap.moreSets }) : null} good />
                        ) : recap.cardioMinutes > 0 && (
                            <Row label={t('cardio')} value={recap.cardioMinutes} unit={t('minutes')} note={null} />
                        )}
                    </dl>
                )}

                <div className="flex gap-2">
                    {/* Leaving the page takes the sheet with it, with no close: it keeps the week as seen itself */}
                    <Link href={`/history?tab=reports&report=${recap.start}`} onClick={seen} className={`${BUTTON.secondary} flex-1`}>{t('fullReport')}</Link>
                    <button className={`${BUTTON.primary} flex-1`}>{t('close')}</button>
                </div>
            </div>
        </Sheet>
    )
}

/** One number of the week, and under it what it is, or how it beat the week before */
function Row({ label, value, unit, note, good }: { label: string; value: number; unit: string; note: string | null; good?: boolean }) {
    return (
        <div className="py-3">
            <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[15px] md:text-sm">{label}</dt>
                <dd className="font-mono text-[17px] font-bold tabular-nums">
                    {value}{unit && <small className="font-sans text-[13px] font-medium text-muted"> {unit}</small>}
                </dd>
            </div>
            {note && <dd className={`truncate text-[13px] md:text-xs ${good ? 'font-semibold text-good' : 'text-muted'}`}>{note}</dd>}
        </div>
    )
}
