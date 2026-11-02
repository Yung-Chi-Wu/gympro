import { useTranslations } from 'next-intl'
import { latestReached, nextMark, reachedTiers, TIERS, type AwardId, type AwardTrack, type Tier } from '@/lib/awards'
import type { WeightUnit } from '@/lib/weight-unit'

// 紀錄's 成就 tab: how many medals the user has, then one row per award. A row shows the highest
// medal reached, in its metal (grey before the first), and a bar to the next one with what is
// left. Each medal is named in words, so none is told by its color alone. A medal is a hexagon
// badge with a faceted rim, its mark the design and its unit stamped under it, as Apple Fitness and
// Peloton make the number the design; one not yet reached is the same badge in grey.

const CARD = 'rounded-card border border-line bg-card'
const LIFTS: AwardId[] = ['squat', 'bench', 'deadlift', 'press']

/** A medal's colors once reached; the class names are written out whole for Tailwind */
const METAL: Record<Tier, { ink: string; name: string; bar: string; face: string; edge: string }> = {
    bronze: { ink: 'fill-bronze-ink', name: 'text-bronze', bar: 'bg-bronze-edge', face: 'var(--color-bronze-medal)', edge: 'var(--color-bronze-edge)' },
    silver: { ink: 'fill-silver-ink', name: 'text-silver', bar: 'bg-silver-edge', face: 'var(--color-silver-medal)', edge: 'var(--color-silver-edge)' },
    gold: { ink: 'fill-gold-ink', name: 'text-gold', bar: 'bg-gold-edge', face: 'var(--color-gold-medal)', edge: 'var(--color-gold-edge)' },
}

/** 112.5 as 112.5, 100 as 100 */
const number = (n: number) => String(Math.round(n * 10) / 10)

/** 10/22, or Oct 22 */
const shortDate = (date: string, language: string) => language === 'zh-TW'
    ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
    : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function Awards({ tracks, language, weightUnit }: { tracks: AwardTrack[]; language: string; weightUnit: WeightUnit }) {
    const t = useTranslations('awards')
    const reached = tracks.flatMap(reachedTiers)
    const latest = latestReached(tracks)
    // Stamped under a medal's mark: the weight unit, or the award's own
    const stamp = (id: AwardId) => (LIFTS.includes(id) ? weightUnit.toUpperCase() : t(`stamps.${id as 'pullup' | 'weeks' | 'records'}`))
    const value = (id: AwardId, n: number) =>
        LIFTS.includes(id) ? t('values.weight', { n: number(n), unit: weightUnit }) : t(`values.${id as 'pullup' | 'weeks' | 'records'}`, { n: number(n) })
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
                {list(t('strength'), [...LIFTS, 'pullup'])}
                {list(t('keepingAt'), ['weeks', 'records'])}
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
                    <p className="shrink-0 text-[13px] text-muted tabular-nums">{track.best > 0 ? value(track.id, track.best) : t('notYet')}</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <div className={`h-full rounded-full ${METAL[next?.tier ?? 'gold'].bar}`} style={{ width: `${(next ? next.share : 1) * 100}%` }} />
                    </div>
                    <p className="shrink-0 text-xs text-muted tabular-nums">
                        {!next
                            ? t('allDone')
                            : track.best > 0
                                ? t('nextToGo', { tier: t(`tiers.${next.tier}`), left: value(track.id, next.value - track.best) })
                                : t('nextAt', { tier: t(`tiers.${next.tier}`), value: value(track.id, next.value) })}
                    </p>
                </div>
            </div>
        </li>
    )
}

const mix = (a: string, share: number, b: string) => `color-mix(in oklab, ${a} ${Math.round(share)}%, ${b})`
const hexagon = (r: number) => [-90, -30, 30, 90, 150, 210].map((deg) => [32 + r * Math.cos((deg * Math.PI) / 180), 32 + r * Math.sin((deg * Math.PI) / 180)])
const points = (p: number[][]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
const OUTER = hexagon(30)
const INNER = hexagon(23.5)
/** The rim's six facets, each with how much light it catches from the top left (-1 to 1) */
const FACETS = OUTER.map((_, i) => {
    const j = (i + 1) % 6
    return { points: points([OUTER[i], OUTER[j], INNER[j], INNER[i]]), light: Math.cos(((-60 + i * 60 - 225) * Math.PI) / 180) }
})

/** A medal as a hexagon badge: a faceted rim lit from the top left, its mark in the middle and its
 * unit stamped under it. `id` names its gradient, so it is unique on the page */
function Medal({ id, tier, value, stamp, reached }: { id: string; tier: Tier; value: string; stamp: string; reached: boolean }) {
    const m = METAL[tier]
    const latin = /^[A-Z]/.test(stamp)
    return (
        <svg viewBox="0 0 64 64" className="size-12 shrink-0" aria-hidden>
            {reached && (
                <defs>
                    <linearGradient id={`face-${id}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" style={{ stopColor: mix(m.face, 75, 'white') }} />
                        <stop offset="0.55" style={{ stopColor: m.face }} />
                        <stop offset="1" style={{ stopColor: mix(m.face, 75, m.edge) }} />
                    </linearGradient>
                </defs>
            )}
            {FACETS.map((f) => (
                <polygon
                    key={f.points} points={f.points}
                    style={{
                        fill: reached
                            ? f.light > 0 ? mix(m.face, 100 - f.light * 45, 'white') : mix(m.face, 100 + f.light * 75, m.edge)
                            : f.light > 0 ? 'var(--color-line)' : mix('var(--color-line)', 80, 'var(--color-faint)'),
                    }}
                />
            ))}
            <polygon points={points(INNER)} style={{ fill: reached ? `url(#face-${id})` : 'var(--color-done)' }} />
            <polygon points={points(hexagon(21))} fill="none" strokeWidth="0.6" opacity="0.6" style={{ stroke: reached ? m.edge : 'var(--color-line)' }} />
            <text
                x="32" y="29.2" textAnchor="middle" dominantBaseline="central" fontSize={value.length > 2 ? 14 : 17} fontWeight="700"
                letterSpacing="-0.6" className={`font-mono ${reached ? m.ink : 'fill-faint'}`}
            >
                {value}
            </text>
            <text
                x="32" y="42.6" textAnchor="middle" dominantBaseline="central" fontSize={latin ? 6.2 : 7} fontWeight="700"
                letterSpacing={latin ? 1 : 0} opacity="0.75" className={reached ? m.ink : 'fill-faint'}
            >
                {stamp}
            </text>
        </svg>
    )
}
