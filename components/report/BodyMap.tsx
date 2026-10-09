import { useId } from 'react'
import type { MuscleFacts } from '@/lib/report/types'

// A body outline, front and back, with each trained muscle group shaded by whether its
// weekly sets are in range. One smooth silhouette (the right half, mirrored); the
// shading is clipped inside it, and untrained areas stay plain.

const RIGHT: [number, number][] = [[55, 26], [57, 31], [66, 33], [74, 37], [79, 44], [81, 58], [83, 78], [85, 100], [86, 112], [85, 120], [81, 121], [79, 113],
    [77, 98], [75, 80], [72, 62], [69, 54], [68, 70], [66, 86], [68, 100], [68, 122], [66, 146], [64, 170], [62, 190], [64, 198], [55, 199], [55, 188],
    [54, 166], [53, 140], [52, 118], [50, 110]]
const OUTLINE = [...RIGHT, ...RIGHT.slice(0, -1).reverse().map(([x, y]): [number, number] => [100 - x, y])]

/** A closed Catmull-Rom curve through the points, as cubic Béziers. */
function smoothPath(pts: [number, number][]): string {
    let d = `M${pts[0].join(',')}`
    for (let i = 0; i < pts.length; i++) {
        const p0 = pts[(i - 1 + pts.length) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length], p3 = pts[(i + 2) % pts.length]
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6].map((n) => n.toFixed(1))
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6].map((n) => n.toFixed(1))
        d += ` C${c1.join(',')} ${c2.join(',')} ${p2.join(',')}`
    }
    return `${d} Z`
}
const BODY = smoothPath(OUTLINE)

// [cx, cy, rx, ry] on the right side; mirrored unless centred
type Region = [number, number, number, number]
const FRONT: Record<string, Region[]> = {
    shoulders: [[74, 41, 8, 8]],
    chest: [[59, 46, 9, 8]],
    biceps: [[78, 63, 5, 11]],
    core: [[50, 76, 9, 13]],
    legs: [[59, 128, 8, 20], [60, 172, 5, 13]],
}
const BACK: Record<string, Region[]> = {
    shoulders: [[74, 41, 8, 8]],
    back: [[50, 52, 17, 16], [50, 78, 9, 9]],
    triceps: [[78, 63, 5, 11]],
    glutes: [[58, 104, 8, 9]],
    legs: [[59, 132, 8, 18], [60, 172, 5, 13]],
}

const FILL: Record<MuscleFacts['status'], string> = {
    ok: 'fill-emerald-500/80 dark:fill-emerald-400/70',
    low: 'fill-amber-500/85 dark:fill-amber-400/80',
    high: 'fill-sky-500/80 dark:fill-sky-400/70',
    no_target: 'fill-ink/25 dark:fill-white/25',
}

function Figure({ id, regions, statusOf, label }: { id: string; regions: Record<string, Region[]>; statusOf: (g: string) => MuscleFacts['status'] | null; label: string }) {
    return (
        <figure className="m-0 flex flex-col items-center gap-1">
            <svg viewBox="0 0 100 210" className="h-auto w-full max-w-[120px]" role="img" aria-label={label}>
                <defs>
                    <clipPath id={id}>
                        <path d={BODY} />
                        <circle cx={50} cy={14} r={11} />
                    </clipPath>
                </defs>
                <path d={BODY} className="fill-white dark:fill-[#24211C]" />
                <g clipPath={`url(#${id})`}>
                    {Object.entries(regions).flatMap(([group, shapes]) => {
                        const status = statusOf(group)
                        if (!status) return []
                        return shapes.flatMap(([cx, cy, rx, ry], i) => {
                            const at = cx === 50 ? [cx] : [cx, 100 - cx]
                            return at.map((x) => <ellipse key={`${group}-${i}-${x}`} cx={x} cy={cy} rx={rx} ry={ry} className={FILL[status]} />)
                        })
                    })}
                </g>
                <path d={BODY} fill="none" className="stroke-ink/40 dark:stroke-white/40" strokeWidth={1.2} strokeLinejoin="round" />
                <circle cx={50} cy={14} r={11} className="fill-white stroke-ink/40 dark:fill-[#24211C] dark:stroke-white/40" strokeWidth={1.2} />
            </svg>
            <figcaption className="text-[11px] text-ink/50 dark:text-white/50">{label}</figcaption>
        </figure>
    )
}

export function BodyMap({ muscles, frontLabel, backLabel }: { muscles: MuscleFacts[]; frontLabel: string; backLabel: string }) {
    const statusOf = (group: string) => {
        const m = muscles.find((x) => x.group === group)
        return m && m.sets > 0 ? m.status : m?.status === 'low' ? 'low' : null
    }
    // The dashboard can show the report twice (phone and desktop layouts), so clip ids must be unique
    const id = useId().replace(/:/g, '')
    return (
        <div className="grid grid-cols-2 justify-items-center gap-2">
            <Figure id={`${id}-front`} regions={FRONT} statusOf={statusOf} label={frontLabel} />
            <Figure id={`${id}-back`} regions={BACK} statusOf={statusOf} label={backLabel} />
        </div>
    )
}
