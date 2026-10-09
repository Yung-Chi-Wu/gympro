// A small trend line with a faint area and the latest point marked. Gaps (untrained
// periods) are skipped, so the line joins the periods that have a value.

export function Sparkline({ values, width = 76, height = 28, className = 'text-ink/60 dark:text-white/60', label }: {
    values: (number | null)[]
    width?: number
    height?: number
    className?: string
    label: string
}) {
    const known = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
    if (known.length < 2) return <svg width={width} height={height} role="img" aria-label={label} />
    let min = Math.min(...known.map((p) => p[1]))
    let max = Math.max(...known.map((p) => p[1]))
    if (max === min) { max += 1; min -= 1 }
    const pad = 4
    const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1)
    const y = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2)
    const points = known.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    const [lastI, lastV] = known[known.length - 1]
    const area = `M${x(known[0][0])},${height - 2} L${points.join(' L')} L${x(lastI)},${height - 2} Z`
    return (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} role="img" aria-label={label}>
            <path d={area} fill="currentColor" fillOpacity={0.12} />
            <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(lastI)} cy={y(lastV)} r={3} fill="currentColor" />
        </svg>
    )
}
