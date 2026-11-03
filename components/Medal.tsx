import { useTranslations } from 'next-intl'
import type { AwardId, Tier } from '@/lib/awards'
import type { WeightUnit } from '@/lib/weight-unit'

// A medal of 成就 (components/Awards.tsx), also drawn larger on Today when one is new
// (components/MedalCard.tsx). It is a hexagon badge with a faceted rim, its mark the design and its
// unit stamped under it, as Apple Fitness and Peloton make the number the design; one not yet
// reached is the same badge in grey.

export const LIFTS: AwardId[] = ['squat', 'bench', 'deadlift', 'press']
/** The awards that count reps, lifts, days or times, each with its own word */
type CountAward = 'pullup' | 'stronger' | 'days' | 'weeks' | 'records'

/** A medal's colors once reached; the class names are written out whole for Tailwind */
export const METAL: Record<Tier, { ink: string; name: string; bar: string; face: string; edge: string }> = {
    bronze: { ink: 'fill-bronze-ink', name: 'text-bronze', bar: 'bg-bronze-edge', face: 'var(--color-bronze-medal)', edge: 'var(--color-bronze-edge)' },
    silver: { ink: 'fill-silver-ink', name: 'text-silver', bar: 'bg-silver-edge', face: 'var(--color-silver-medal)', edge: 'var(--color-silver-edge)' },
    gold: { ink: 'fill-gold-ink', name: 'text-gold', bar: 'bg-gold-edge', face: 'var(--color-gold-medal)', edge: 'var(--color-gold-edge)' },
}

/** 112.5 as 112.5, 100 as 100 */
export const number = (n: number) => String(Math.round(n * 10) / 10)

/** How a medal's numbers read: stamped under its mark, the weight unit or the award's own; and a value with its unit */
export function useMedalWords(weightUnit: WeightUnit) {
    const t = useTranslations('awards')
    return {
        stamp: (id: AwardId) => (LIFTS.includes(id) ? weightUnit.toUpperCase() : t(`stamps.${id as CountAward}`)),
        value: (id: AwardId, n: number) =>
            LIFTS.includes(id) ? t('values.weight', { n: number(n), unit: weightUnit }) : t(`values.${id as CountAward}`, { n: Math.round(n) }),
    }
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

/** A medal: a faceted rim lit from the top left, its mark in the middle and its unit stamped under
 * it. `id` names its gradient, so it is unique on the page */
export function Medal({ id, tier, value, stamp, reached, className = 'size-12' }: { id: string; tier: Tier; value: string; stamp: string; reached: boolean; className?: string }) {
    const m = METAL[tier]
    const latin = /^[A-Z]/.test(stamp)
    return (
        <svg viewBox="0 0 64 64" className={`${className} shrink-0`} aria-hidden>
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
