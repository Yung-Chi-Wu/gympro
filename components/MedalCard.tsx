'use client'

import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { reportClientError } from '@/lib/report-client-error'
import type { NewMedal } from '@/lib/today-overlay'
import type { WeightUnit } from '@/lib/weight-unit'
import { BUTTON } from '@/lib/ui'
import { Medal, METAL, number, useMedalWords } from './Medal'
import { Sheet } from './Sheet'

/** The day checked through, closed on this visit: a save that failed doesn't open it again before the next */
const CLOSED_KEY = 'medals_closed'

// sessionStorage doesn't announce changes in this tab; it is read when the card renders
const subscribeNothing = () => () => {}

/** Keeps the days up to `through` as checked for medals (user_profiles.awards_seen_date) */
function keepChecked(userId: string, through: string) {
    void createClient().from('user_profiles').update({ awards_seen_date: through }).eq('user_id', userId)
        .then(({ error }) => { if (error) reportClientError('client/today/medals-seen', error) })
}

/**
 * New medals, in a popup over Today the day after they are reached (when, in lib/today-overlay.ts;
 * owner, 2026-11-03): every one since the last check in one popup, never one after another. One is
 * drawn large with the next one to reach; several, side by side. Each is named in words with its
 * metal, so none is told by its color alone. They land one after another and a light passes over
 * each, with no confetti; with reduced motion nothing moves. However it is closed, the days up to
 * yesterday are kept as checked.
 */
export function MedalCard({ medals, through, userId, weightUnit }: {
    medals: NewMedal[]
    through: string
    userId: string
    weightUnit: WeightUnit
}) {
    const t = useTranslations('medals')
    const ta = useTranslations('awards')
    const { stamp, value } = useMedalWords(weightUnit)
    const titleId = useId()
    // Closed on the server, as the popup opens only in the browser
    const closedThisVisit = useSyncExternalStore(subscribeNothing, () => {
        try { return sessionStorage.getItem(CLOSED_KEY) === through } catch { return false }
    }, () => true)
    const [closed, setClosed] = useState(false)

    function seen() {
        try { sessionStorage.setItem(CLOSED_KEY, through) } catch {}
        setClosed(true)
        keepChecked(userId, through)
    }

    if (closedThisVisit || closed) return null
    const one = medals.length === 1 ? medals[0] : null
    // The words come in once the medals have landed
    const textDelay = { animationDelay: `${MEDAL_START + medals.length * MEDAL_STEP + 200}ms` }

    return (
        <Sheet labelledBy={titleId} onClose={seen} centered>
            <div className="space-y-6">
                {one ? (
                    // One medal is the whole popup (Apple Fitness, Runna): large, its name and the next one under it
                    <div className="flex flex-col items-center gap-5 pt-3 text-center">
                        <ShownMedal medal={one} stamp={stamp(one.id)} index={0} className="size-48" />
                        <div className="space-y-1 motion-safe:animate-rise" style={textDelay}>
                            <p className="text-[13px] font-semibold text-muted">{t('eyebrow')}</p>
                            <h2 id={titleId} className="text-[22px] font-bold text-balance">{t('one', { award: ta(`names.${one.id}`), tier: ta(`tiers.${one.tier}`) })}</h2>
                            <p className="text-[15px] text-muted">
                                {one.next ? t('next', { medal: ta('nextAt', { tier: ta(`tiers.${one.next.tier}`), value: value(one.id, one.next.mark) }) }) : ta('allDone')}
                            </p>
                        </div>
                    </div>
                ) : (
                    // Several, side by side under how many (Duolingo's badges, Hevy's "3 new PRs"), never one after another
                    <div className="space-y-5 text-center">
                        <div className="space-y-1">
                            <p className="text-[13px] font-semibold text-muted">{t('eyebrow')}</p>
                            <h2 id={titleId} className="text-[22px] font-bold text-balance">{t('several', { n: medals.length })}</h2>
                        </div>
                        <ul className="flex flex-wrap justify-center gap-y-4">
                            {medals.map((m, i) => (
                                <li key={m.id} className="flex w-1/3 flex-col items-center gap-1">
                                    <ShownMedal medal={m} stamp={stamp(m.id)} index={i} className="mb-1 size-20" />
                                    <span className="text-[13px] font-semibold motion-safe:animate-rise" style={textDelay}>{ta(`names.${m.id}`)}</span>
                                    <span className={`text-xs motion-safe:animate-rise ${METAL[m.tier].name}`} style={textDelay}>
                                        {t('mark', { tier: ta(`tiers.${m.tier}`), value: value(m.id, m.mark) })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="flex gap-2">
                    <button className={`${BUTTON.secondary} flex-1`}>{t('close')}</button>
                    {/* Leaving the page takes the popup with it, with no close: it keeps the days as checked itself */}
                    <Link href="/history?tab=awards" onClick={seen} className={`${BUTTON.primary} flex-1`}>{t('all')}</Link>
                </div>
            </div>
        </Sheet>
    )
}

/** When the first medal lands once the popup is open, and each after it (ms) */
const MEDAL_START = 150
const MEDAL_STEP = 120
/** The medal's outline (Medal.tsx's rim, r 30 of 64), for its light to pass over it alone */
const HEXAGON = 'polygon(50% 3.1%, 90.6% 26.6%, 90.6% 73.4%, 50% 96.9%, 9.4% 73.4%, 9.4% 26.6%)'

/** A new medal as it comes in: it lands, its metal glows behind it, and a light passes over it once */
function ShownMedal({ medal, stamp, index, className }: { medal: NewMedal; stamp: string; index: number; className: string }) {
    const delay = MEDAL_START + index * MEDAL_STEP
    return (
        <span className={`relative grid place-items-center ${className}`}>
            <span aria-hidden className="absolute -inset-1/4 rounded-full motion-safe:animate-glow"
                style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${METAL[medal.tier].face} 60%, transparent), transparent)`, animationDelay: `${delay + 150}ms` }} />
            <span className="relative size-full motion-safe:animate-medal" style={{ animationDelay: `${delay}ms` }}>
                <Medal id={`new-${medal.id}`} tier={medal.tier} reached value={number(medal.mark)} stamp={stamp} className="size-full" />
                <span aria-hidden className="absolute inset-0 overflow-hidden" style={{ clipPath: HEXAGON }}>
                    <span className="absolute inset-y-0 -left-1/2 w-1/2 bg-linear-to-r from-transparent via-white/60 to-transparent motion-safe:animate-shine"
                        style={{ animationDelay: `${delay + 550}ms` }} />
                </span>
            </span>
        </span>
    )
}

/** A check that found no new medal: keeps the days up to yesterday as checked, so Today reads the log for medals at most once a day */
export function MedalsChecked({ through, userId }: { through: string; userId: string }) {
    useEffect(() => keepChecked(userId, through), [userId, through])
    return null
}
