'use client'

import { useId, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { reportClientError } from '@/lib/report-client-error'
import { RELEASES, type Release, type ReleaseArt, type ReleaseItem } from '@/lib/releases'
import { BUTTON } from '@/lib/ui'
import { Medal } from './Medal'
import { Sheet } from './Sheet'
import { shortDate } from './report/ReportView'

/** The entry closed on this visit: a save that failed doesn't open it again before the next */
const CLOSED_KEY = 'release_closed'

// sessionStorage doesn't announce changes in this tab; it is read when the popup renders
const subscribeNothing = () => () => {}

/**
 * What a big update brought, in a popup over Today, once (when, in lib/today-overlay.ts; owner,
 * 2026-11-02), as Apple's own apps show theirs: a title, a few items of a name and one sentence,
 * and one button, with no link on each item; each says where it is instead (owner, 2026-11-03).
 * Above them, a picture of the features themselves (Hero), never a stock icon. It says where the
 * list is kept (Settings, 最近更新). However it is closed, the entry is kept as seen
 * (user_profiles.release_seen).
 */
export function WhatsNew({ release, userId, language }: { release: Release; userId: string; language: string }) {
    const t = useTranslations('whatsNew')
    const titleId = useId()
    // Closed on the server, as the popup opens only in the browser
    const closedThisVisit = useSyncExternalStore(subscribeNothing, () => {
        try { return sessionStorage.getItem(CLOSED_KEY) === release.date } catch { return false }
    }, () => true)
    const [closed, setClosed] = useState(false)

    function seen() {
        try { sessionStorage.setItem(CLOSED_KEY, release.date) } catch {}
        setClosed(true)
        void createClient().from('user_profiles').update({ release_seen: release.date }).eq('user_id', userId)
            .then(({ error }) => { if (error) reportClientError('client/today/release-seen', error) })
    }

    if (closedThisVisit || closed) return null

    return (
        <Sheet labelledBy={titleId} onClose={seen} centered>
            <div className="space-y-5">
                <Hero items={release.items} />
                <div className="space-y-1.5 motion-safe:animate-rise" style={{ animationDelay: '250ms' }}>
                    <p className="text-[13px] font-bold tracking-wide text-accent">{t('tag', { date: shortDate(release.date) })}</p>
                    <h2 id={titleId} className="text-[26px] leading-tight font-bold text-balance">{t('title')}</h2>
                </div>
                <ReleaseItems items={release.items} zh={language === 'zh-TW'} />
                <div className="space-y-3">
                    <p className="text-center text-[13px] text-muted">{t('later')}</p>
                    <button className={`${BUTTON.primary} w-full`}>{t('close')}</button>
                </div>
            </div>
        </Sheet>
    )
}

/** How each drawing leans in the picture, so they read as laid down by hand, not lined up */
const TILT = [-8, 6, -4]

/**
 * The update's features drawn large, side by side and overlapping, over the accent's light, as
 * Notion's and Figma's announcements open on a picture of the feature itself. They land one after
 * another as the popup opens.
 */
function Hero({ items }: { items: ReleaseItem[] }) {
    return (
        <div aria-hidden className="-mx-5 -mt-5 flex h-36 items-center justify-center overflow-hidden rounded-t-sheet pt-3"
            style={{ background: 'radial-gradient(120% 100% at 50% 0%, var(--color-accent-soft), transparent 78%)' }}>
            {items.map((item, i) => (
                <div key={item.title.en} className={`motion-safe:animate-medal ${i ? '-ml-4' : ''}`}
                    style={{ rotate: `${TILT[i % TILT.length]}deg`, zIndex: items.length - i, animationDelay: `${100 + i * 120}ms` }}>
                    <Art art={item.art} large />
                </div>
            ))}
        </div>
    )
}

/**
 * An entry's items, one after another: each one's name, sentence and where it is, in the names
 * the app's menus show. In Settings, each with its drawing small beside it; the popup has them
 * large above (Hero).
 */
function ReleaseItems({ items, zh, drawings = false }: { items: ReleaseItem[]; zh: boolean; drawings?: boolean }) {
    const t = useTranslations('whatsNew')
    return (
        <ul className={drawings ? 'space-y-5' : 'divide-y divide-line border-y border-line'}>
            {items.map((item, i) => (
                <li key={item.title.en} className={`flex items-start gap-3.5 motion-safe:animate-rise ${drawings ? '' : 'py-3.5'}`}
                    style={{ animationDelay: `${350 + i * 100}ms` }}>
                    {drawings && (
                        <span className="grid size-13 shrink-0 place-items-center rounded-2xl bg-accent-soft" aria-hidden>
                            <Art art={item.art} />
                        </span>
                    )}
                    <div className="min-w-0 space-y-1.5">
                        <div className="space-y-0.5">
                            <h3 className="text-base font-bold">{zh ? item.title.zh : item.title.en}</h3>
                            {/* Chinese breaks at its punctuation, so 「紀錄」 stays on one line; a phrase too long for it still wraps */}
                            <p className={`text-[15px] leading-relaxed text-pretty wrap-break-word text-muted ${zh ? 'break-keep' : ''}`}>{zh ? item.body.zh : item.body.en}</p>
                        </div>
                        <p className="inline-flex items-center gap-1.5 rounded-full bg-done px-2.5 py-1 text-xs">
                            <span className="text-muted">{t('where')}</span>
                            <span className="font-semibold">{zh ? item.where.zh : item.where.en}</span>
                        </p>
                    </div>
                </li>
            ))}
        </ul>
    )
}

/** Six weeks' days trained, the last in the accent, as the recap draws them (WeeklyRecap.tsx) */
const ART_WEEKS = [3, 4, 3, 5, 4, 6]
/** A week's days, the trained ones filled, as the recap's dots */
const ART_DAYS = [true, false, true, false, true, true, false]

/** A feature drawn: its own medal, or the recap's week and weeks; large in the popup's picture, small in Settings */
function Art({ art, large = false }: { art: ReleaseArt; large?: boolean }) {
    const id = useId()
    const t = useTranslations('awards')
    switch (art) {
        case 'medal':
            return (
                <span className="relative grid place-items-center">
                    {large && <span className="absolute -inset-1/3 rounded-full" style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--color-gold-medal) 55%, transparent), transparent)' }} />}
                    <Medal id={`release-${id}`} tier="gold" reached value="150" stamp={t('stamps.days')} className={large ? 'relative size-24' : 'size-10'} />
                </span>
            )
        case 'weeks': {
            const bars = (
                <span className={`flex items-end ${large ? 'h-11 gap-1' : 'h-7 gap-0.5'}`}>
                    {ART_WEEKS.map((days, i) => (
                        <span key={i} className={`rounded-xs ${large ? 'w-3' : 'w-1.5'} ${i === ART_WEEKS.length - 1 ? 'bg-accent' : 'bg-accent/35'}`} style={{ height: `${(days / 7) * 100}%` }} />
                    ))}
                </span>
            )
            if (!large) return bars
            // The recap itself, in small: its week of dots over its weeks' bars
            return (
                <span className="flex flex-col gap-2.5 rounded-2xl border border-line bg-raised p-3 shadow-float">
                    <span className="flex gap-1">
                        {ART_DAYS.map((on, i) => <span key={i} className={`size-3 rounded-full ${on ? 'bg-accent' : 'bg-done'}`} />)}
                    </span>
                    {bars}
                </span>
            )
        }
    }
}

/** 2026/11/3, or Nov 3, 2026: the list spans years */
const fullDate = (date: string, zh: boolean) => zh
    ? `${date.slice(0, 4)}/${shortDate(date)}`
    : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** Settings' 最近更新: every entry, newest first, each under the day it shipped */
export function ReleaseList({ zh }: { zh: boolean }) {
    return (
        <div className="space-y-5">
            {RELEASES.map((release) => (
                <section key={release.date} className="space-y-1">
                    <h3 className="text-[13px] font-semibold text-muted">{fullDate(release.date, zh)}</h3>
                    <ReleaseItems items={release.items} zh={zh} drawings />
                </section>
            ))}
        </div>
    )
}
