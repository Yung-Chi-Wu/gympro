import type { ReactNode } from 'react'
import type { useTranslations } from 'next-intl'
import type { LogType } from '@/lib/exercise-attributes'
import { fieldValue, fitsLogType, isWeightField, summarize, type FieldKey, type SetValues, type SummaryPart, type Units } from '@/lib/set-log'
import type { Target } from '@/lib/today-workout'

// How sets read in the user's language (messages: sets): the logging table's headers and
// cells, the summary under an exercise's name, and the compact sets in the history list.

/** The translator for the sets namespace */
type SetsT = ReturnType<typeof useTranslations>

const speedUnit = (units: Units) => (units.distance === 'mi' ? 'mph' : 'km/h')
const grouped = (n: number) => n.toLocaleString('en-US')

export function fieldLabel(t: SetsT, key: FieldKey, units: Units): string {
    return t(`fields.${key}`, { unit: key === 'speed' ? speedUnit(units) : units.weight })
}

/**
 * A logged value as its cell shows it: bodyweight alone reads BW, added weight has a plus. A
 * weight shows in the unit it was typed in, so 80 lb reads 80 again; when that isn't the
 * column's unit the cell says which it is.
 */
export function cellText(t: SetsT, key: FieldKey, s: SetValues, units: Units): string {
    const own = isWeightField(key) && s.inputUnit && s.inputUnit !== units.weight ? s.inputUnit : null
    const v = fieldValue(key, s, own ? { ...units, weight: own } : units)
    if (v == null) return ''
    const suffix = own ? ` ${own}` : ''
    if (key === 'added') return v === 0 ? t('bodyweight') : `+${v}${suffix}`
    return `${v}${suffix}`
}

/** One set on one line, for lists. A set logged before its exercise's log type reads as weight x reps. */
export function compactSet(t: SetsT, logType: LogType, s: SetValues, units: Units): string {
    const v = (key: FieldKey) => fieldValue(key, s, units) ?? 0
    const weightReps = () => t('compact.weightReps', { weight: v('weight'), unit: units.weight, reps: s.reps })
    if (!fitsLogType(logType, s)) return weightReps()
    switch (logType) {
        case 'weight_reps':
            return weightReps()
        case 'bodyweight':
            return s.weightKg === 0 ? t('compact.bodyweight', { reps: s.reps }) : t('compact.added', { weight: v('added'), unit: units.weight, reps: s.reps })
        case 'assisted':
            return t('compact.assisted', { weight: v('assist'), unit: units.weight, reps: s.reps })
        case 'duration':
            return t('compact.duration', { seconds: v('seconds') })
        case 'treadmill':
            return t('compact.treadmill', { minutes: v('minutes'), speed: v('speed'), speedUnit: speedUnit(units), incline: v('incline') })
        case 'cardio_level':
            return t('compact.cardioLevel', { minutes: v('minutes'), level: v('level') })
        case 'rower':
            return t('compact.rower', { minutes: v('minutes'), metres: grouped(v('metres')) })
        case 'cardio_time':
            return t('compact.cardioTime', { minutes: v('minutes') })
    }
}

/** Log types whose target counts reps; for the others a target is a number of sets */
const COUNTS_REPS = new Set<LogType>(['weight_reps', 'bodyweight', 'assisted'])

/**
 * The line under an exercise's name, numbers in bold. Before the first set it is the
 * routine's target (nothing for an exercise added just for today); after, the sets
 * logged, out of the target when there is one.
 */
export function SummaryLine({ t, logType, sets, units, target = null }: { t: SetsT; logType: LogType; sets: SetValues[]; units: Units; target?: Target | null }) {
    const parts = summarize(logType, sets, units)
    const b = (chunks: ReactNode) => <b className="font-mono font-bold text-ink">{chunks}</b>
    if (!parts.length) {
        if (!target) return null
        return target.reps && COUNTS_REPS.has(logType)
            ? <>{t.rich('summary.targetReps', { sets: target.sets, reps: target.reps, b })}</>
            : <>{t.rich('summary.target', { sets: target.sets, b })}</>
    }
    const partText = (p: SummaryPart) => {
        switch (p.kind) {
            case 'sets': return target
                ? t.rich('summary.setsOf', { count: p.count, target: target.sets, b })
                : t.rich('summary.sets', { count: p.count, b })
            case 'best': return t.rich('summary.best', { weight: p.weight, unit: units.weight, reps: p.reps, b })
            case 'reps': return t.rich('summary.reps', { count: p.count, b })
            case 'seconds': return t.rich('summary.seconds', { count: p.count, b })
            case 'minutes': return t.rich('summary.minutes', { count: p.count, b })
            case 'distance': return t.rich(units.distance === 'mi' ? 'summary.mi' : 'summary.km', { value: p.value, b })
            case 'metres': return t.rich('summary.metres', { value: grouped(p.value), b })
        }
    }
    return (
        <>
            {parts.map((p, i) => (
                <span key={p.kind}>
                    {i > 0 && t('summary.separator')}
                    {partText(p)}
                </span>
            ))}
        </>
    )
}
