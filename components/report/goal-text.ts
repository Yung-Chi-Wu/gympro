'use client'

import { useTranslations } from 'next-intl'
import type { GoalRead } from '@/lib/report/types'
import { toDisplayWeight, type WeightUnit } from '@/lib/weight-unit'

// How a goal as read is written: in the report (ReportView.tsx) and under the goal in Settings,
// so both say the same thing. Its own module, so Settings doesn't load the report.

export type GoalTextProps = { read: GoalRead | null; zh: boolean; weightUnit: WeightUnit; muscle: (g: string) => string }

/** Shared by the goal rows and their detail: names, weights in the goal's own unit */
export function useGoalText({ read, zh, weightUnit, muscle }: GoalTextProps) {
    const t = useTranslations('reportV3.goal')
    // One unit for the goal: the one it wrote its numbers in, else the user's
    const u: WeightUnit = read?.targets.find((x) => x.unit)?.unit ?? weightUnit
    const num = (kg: number) => String(toDisplayWeight(kg, u))
    const name = (x: { name?: string; nameZh?: string | null }) => String((zh && x.nameZh) || x.name || '')
    const sep = zh ? '、' : ', '
    const focusLabel = (units: string[] | undefined) => (units ?? []).map(muscle).join(sep)
    return { t, read, u, num, name, sep, focusLabel }
}

/** The goal as read, a label for each kind and target ("strength", "Barbell Back Squat 140 kg"): in the report's detail, and under the goal in Settings */
export function useGoalReadLabels(props: GoalTextProps): string[] {
    const { t, read, u, num, name, focusLabel } = useGoalText(props)
    if (!read?.model) return []
    return [
        ...read.kinds.map((k) => t(`kinds.${k}`)),
        ...read.targets.map((tg) => tg.kind === 'lift'
            ? `${name(tg)}${tg.loadKg != null ? ` ${num(tg.loadKg)} ${u}${tg.reps && tg.reps > 1 ? ` × ${tg.reps}` : ''}` : tg.reps ? ` ${t('repsTarget', { n: tg.reps })}` : ''}`
            : tg.kind === 'body_weight' ? `${t('bodyWeight')} ${num(tg.weightKg ?? 0)} ${u}`
            : tg.kind === 'body_fat' ? `${t('bodyFat')} ${tg.bodyFatPct}%`
            : focusLabel(tg.units)),
    ]
}
