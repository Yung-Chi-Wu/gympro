import { useTranslations } from 'next-intl'
import { latestReached, nextMark, reachedTiers, TIERS, type AwardId, type AwardTrack } from '@/lib/awards'
import type { WeightUnit } from '@/lib/weight-unit'
import { LIFTS, Medal, METAL, number, useMedalWords } from './Medal'

// 紀錄's 成就 tab: how many medals the user has, then one row per award. A row shows the highest
// medal reached (components/Medal.tsx), in its metal (grey before the first), and a bar to the next
// one: how far along until halfway, what is left after, where people look (Koo & Fishbach 2012).
// Each medal is named in words, so none is told by its color alone.

const CARD = 'rounded-card border border-line bg-card'

/** 10/22, or Oct 22 */
const shortDate = (date: string, language: string) => language === 'zh-TW'
    ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
    : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function Awards({ tracks, language, weightUnit }: { tracks: AwardTrack[]; language: string; weightUnit: WeightUnit }) {
    const t = useTranslations('awards')
    const reached = tracks.flatMap(reachedTiers)
    const latest = latestReached(tracks)
    const { stamp, value } = useMedalWords(weightUnit)
    const list = (title: string, ids: AwardId[]) => (
        <section className="space-y-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <ul className={`${CARD} divide-y divide-line px-4`}>
                {tracks.filter((track) => ids.includes(track.id)).map((track) => <AwardRow key={track.id} track={track} value={value} stamp={stamp(track.id)} />)}
            </ul>
        </section>
    )

    return (
        <div className="space-y-6">
            <section className={`${CARD} flex flex-wrap items-end justify-between gap-x-6 gap-y-2 p-4`}>
                <div>
                    <h2 className="text-[13px] font-medium text-muted">{t('summary')}</h2>
                    <p className="text-3xl font-bold tabular-nums">{t('of', { count: reached.length, total: tracks.length * TIERS.length })}</p>
                    <p className="mt-1 flex gap-3 text-[13px] font-semibold tabular-nums">
                        {TIERS.map((tier) => (
                            <span key={tier} className={METAL[tier].name}>{t('tierCount', { tier: t(`tiers.${tier}`), n: reached.filter((r) => r === tier).length })}</span>
                        ))}
                    </p>
                </div>
                <p className="pb-0.5 text-[13px] text-muted">
                    {latest
                        ? t('latest', { award: t(`names.${latest.id}`), tier: t(`tiers.${latest.tier}`), date: shortDate(latest.date, language) })
                        : t('none')}
                </p>
            </section>
            <div className="grid gap-6 @3xl:grid-cols-2 @3xl:items-start">
                {list(t('strength'), [...LIFTS, 'pullup', 'stronger'])}
                {list(t('keepingAt'), ['days', 'weeks', 'records'])}
            </div>
            <p className="px-1 text-[13px] text-muted">{t('howCounted')}</p>
        </div>
    )
}

function AwardRow({ track, value, stamp }: { track: AwardTrack; value: (id: AwardId, n: number) => string; stamp: string }) {
    const t = useTranslations('awards')
    const top = reachedTiers(track).at(-1) ?? null
    const next = nextMark(track)
    // The medal shown is the highest reached, or the first to reach, in grey
    const shown = top ?? 'bronze'
    return (
        <li className="flex items-center gap-3 py-3">
            <Medal id={track.id} tier={shown} reached={top !== null} value={number(track.tiers[TIERS.indexOf(shown)])} stamp={stamp} />
            <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-[15px] font-semibold md:text-sm">
                        {t(`names.${track.id}`)}
                        {top && <span className={`ml-2 whitespace-nowrap text-[13px] ${METAL[top].name}`}>{t('medal', { tier: t(`tiers.${top}`) })}</span>}
                    </h3>
                    <p className="shrink-0 text-[13px] text-muted tabular-nums">
                        {track.best > 0 ? (track.estimated ? t('estimated', { value: value(track.id, track.best) }) : value(track.id, track.best)) : t('notYet')}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <div className={`h-full rounded-full ${METAL[next?.tier ?? 'gold'].bar}`} style={{ width: `${(next ? next.share : 1) * 100}%` }} />
                    </div>
                    <p className="shrink-0 text-xs text-muted tabular-nums">
                        {!next
                            ? t('allDone')
                            : track.best <= 0
                                ? t('nextAt', { tier: t(`tiers.${next.tier}`), value: value(track.id, next.value) })
                                : next.share < 0.5
                                    ? t('nextOf', { tier: t(`tiers.${next.tier}`), now: number(track.best), mark: value(track.id, next.value) })
                                    : t('nextToGo', { tier: t(`tiers.${next.tier}`), left: value(track.id, next.value - track.best) })}
                    </p>
                </div>
            </div>
        </li>
    )
}
