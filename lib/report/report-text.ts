import en from '../../messages/en.json'
import zh from '../../messages/zh-TW.json'
import { toDisplayWeight, type WeightUnit } from '../weight-unit'
import { unitLabel } from './volume'
import { CODE_RULES, type Finding, type NarrativeItem, type NarrativeLine, type ReportFacts, type ReportNarrative, type RuleId } from './types'
import type { Aim } from './progression'

export { CODE_RULES }

// The report's text in the app's own words (messages/*.json), for the report worker: the
// Chinese terms the model must use, the lines code writes under an action, and the text the
// report falls back to when the model's fails its checks twice.

/**
 * The app's Chinese word for each phrase the brief uses in English. Without them the model
 * coined its own: 主升 for "main lifts" in 9 of 21 Chinese headlines (eval v9), a word the app
 * never shows. check-rules makes sure each phrase is in a brief and each key in both languages.
 */
export const ZH_TERMS: [phrase: string, key: string][] = [
    ['main lifts', 'reportV3.glossary.mainLifts.term'],
    ['best set', 'reportV3.glossary.bestSet.term'],
    ['estimated 1RM', 'reportV3.glossary.e1rm.term'],
    ['new records', 'reportV3.glossary.record.term'],
    // The status as the app labels it: "stalling" reads 持平 there, not 停滯
    ['progressing', 'reportV3.status.progressing'],
    ['stalling', 'reportV3.status.stalling'],
    ['regressing', 'reportV3.status.regressing'],
    ['baseline', 'reportV3.status.baseline'],
    ['flat', 'reportV3.trend.flat'],
    ['cardio', 'reportV3.section.cardio'],
]

type Messages = Record<string, unknown>
export const messageAt = (messages: Messages, key: string): unknown =>
    key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Messages)[k] : undefined), messages)

/** The brief's line that gives the model the app's Chinese words */
export function zhTermsLine(): string {
    const pairs = ZH_TERMS.map(([phrase, key]) => `${phrase} = ${String(messageAt(zh, key))}`)
    return `The app's Chinese words, which the text must use for these, never a short form of your own: ${pairs.join('; ')}.`
}

/**
 * The two ICU forms these labels use, {name} and {name, select, week {...} other {...}}. The
 * worker can't load use-intl (an ES module, the worker is CommonJS); check-worker formats every
 * label used here and fails on anything left in braces.
 */
export function formatLabel(message: string, values: Record<string, string>): string {
    return message
        .replace(/\{(\w+), select, ((?:\w+ \{[^{}]*\}\s*)+)\}/g, (_, name: string, cases: string) => {
            const options = Object.fromEntries([...cases.matchAll(/(\w+) \{([^{}]*)\}/g)].map((m) => [m[1], m[2]]))
            return options[values[name]] ?? options.other ?? ''
        })
        .replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
}

const labelIn = (language: string) => (key: string, values: Record<string, string>) =>
    formatLabel(String(messageAt(language === 'zh-TW' ? zh : en, `reportV3.${key}`) ?? ''), values)

/**
 * The lines under a low_volume action, one per muscle: the ways to add its sets that
 * withExerciseOptions picked, for the user to choose between. In the action's prose, four low
 * muscles with two options each made one paragraph of over 200 characters (the owner's report,
 * 2026-10-18), so code lists them, and code writes the lead too: the model's leads to them varied
 * from run to run without adding anything (eval v11, v12). The model adds only a sentence for a
 * note that bears on the options.
 */
export function optionLines(findings: Finding[], language: string, unit: 'week' | 'cycle'): NarrativeLine[] {
    const isZh = language === 'zh-TW'
    const t = labelIn(language)
    const count = (n: unknown) => (Number(n) === 1 ? 'one' : 'other')
    return findings.filter((f) => f.rule === 'low_volume' && f.subject).map((f) => {
        const d = f.data
        const name = (k: 'addTo' | 'newExercise') => String((isZh && d[`${k}Zh`]) || d[k])
        const options = [
            d.addTo != null && t(Number(d.addToHalf) ? 'options.addToHalf' : 'options.addTo', { exercise: name('addTo'), sets: String(d.addToSets), count: count(d.addToSets), unit }),
            d.newExercise != null && t('options.newExercise', { exercise: name('newExercise'), sets: String(d.newExerciseSets), count: count(d.newExerciseSets), unit }),
        ].filter((x): x is string => !!x)
        return {
            label: unitLabel(String(f.subject), language, (x) => x),
            text: options.length ? options.join(t('options.or', {})) : t('options.none', { sets: String(d.addSets), count: count(d.addSets), unit }),
        }
    })
}

/**
 * Each action with what code writes for it. A low_volume item comes in with the model's sentence
 * for a note, or an empty action, and leaves with the lead before that sentence and a line per muscle.
 */
export function withLines(narrative: ReportNarrative, findings: Finding[], language: string, unit: 'week' | 'cycle'): ReportNarrative {
    const t = labelIn(language)
    const lines = optionLines(findings, language, unit)
    const lead = t(lines.length === 1 ? 'options.leadOne' : 'options.lead', {})
    return {
        ...narrative,
        items: narrative.items.map((i) => {
            if (i.rule !== 'low_volume') return i
            const note = i.action.trim()
            return { ...i, action: note ? `${lead}${language === 'zh-TW' ? '' : ' '}${note}` : lead, lines }
        }),
    }
}

/**
 * The report's text from the app's own labels: the status line as the headline, and each fired
 * rule's short advice with every item named; a low muscle's options are its lines. Plain, but
 * always right, so a report whose text failed its checks twice still arrives instead of failing.
 */
export function fallbackNarrative(facts: ReportFacts, findings: Finding[], language: string, weightUnit: WeightUnit = 'kg'): ReportNarrative {
    const isZh = language === 'zh-TW'
    const t = labelIn(language)
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const rules = [...new Set(findings.map((f) => f.rule))].filter((r) => !CODE_RULES.has(r)) as RuleId[]
    const nameOf = (f: Finding) => String((isZh && f.data.nameZh) || f.data.name || '')
    const muscleOf = (f: Finding) => (f.subject ? unitLabel(f.subject, language, (x) => x) : '')
    const end = isZh ? '。' : '.'
    const own = withLines({
        headline: `${t(`statusHint.${facts.status}`, { unit })}${end}`,
        items: rules.map((rule) => {
            if (rule === 'low_volume') return { rule, action: '' }
            const each = findings.filter((f) => f.rule === rule).map((f) => t(`advised.${rule}`, { lift: nameOf(f), muscle: muscleOf(f), unit }))
            return { rule, action: `${[...new Set(each)].join(isZh ? '；' : '; ')}${end}` }
        }),
    }, findings, language, unit)
    return withPlanItems(own, findings, language, unit, weightUnit)
}

/**
 * The next-session items, written from their findings' numbers: one item for each goal lift
 * and each lift held for pain (by finding), one for the other main lifts with a line each, and
 * one for training on too few days. A lighter week's numbers are lines under the deload's item
 * (withPlanItems), not an item. Weights are in the unit the user logs in.
 */
export function planItems(findings: Finding[], language: string, unit: 'week' | 'cycle', weightUnit: WeightUnit): NarrativeItem[] {
    const isZh = language === 'zh-TW'
    const t = labelIn(language)
    const plan = (key: string, values: Record<string, unknown>) => t(`plan.${key}`, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v ?? '')])))
    const w = (kg: unknown) => `${toDisplayWeight(Number(kg), weightUnit)} ${weightUnit}`
    const name = (d: Finding['data'], prefix = '') => String((isZh && d[prefix ? `${prefix}NameZh` : 'nameZh']) || d[prefix ? `${prefix}Name` : 'name'] || '')
    const or = t('plan.or', {})
    const numbers = (d: Finding['data']) => ({ lift: name(d), weight: w(d.weightKg), next: w(d.nextKg), low: d.low, top: d.top, sets: d.sets, assist: w(d.assistKg), unit })

    const goal = (f: Finding): NarrativeItem => {
        const d = f.data
        const n = numbers(d)
        const via = name(d, 'via')
        const lead = (() => {
            switch (d.path) {
                case 'pulldown': return plan('viaPulldown', { ...n, via, try: d.tryAtKg != null ? plan('tryAt', { tryAt: w(d.tryAtKg), tryReps: d.tryReps, lift: name(d) }) : '' })
                case 'assisted': return plan('viaAssisted', { ...n, via })
                case 'start': return via ? plan('start', { lift: name(d), via }) : plan('startNoVia', { lift: name(d) })
                case 'stalled': return plan('stalled', { ...n, drop: w(d.dropKg), n: d.flatWindows })
                case 'not_trained': return plan('notTrained', n)
                case 'find_weight': return plan('findWeight', n)
                default: return liftLead(String(d.how), n)
            }
        })()
        const options = String(d.options ?? '').split(',').filter(Boolean).map((o): NarrativeLine => {
            switch (o) {
                case 'heavy': return { label: or, text: plan('heavy', { weight: w(d.heavyKg) }) }
                case 'second_day': return { label: or, text: plan('secondDay', { lift: name(d), weight: w(d.secondKg) }) }
                case 'assisted': return { label: or, text: plan('assisted', { name: name(d, 'assisted') }) }
                case 'pulldown': return { label: or, text: plan('pulldown', { name: name(d, 'pulldown') }) }
                default: return { label: or, text: plan('negatives', { lift: name(d) }) }
            }
        })
        return { findingId: f.id, action: lead, ...(options.length ? { lines: options } : {}) }
    }
    const liftLead = (how: string, n: ReturnType<typeof numbers>) =>
        plan(how === 'load_now' ? 'liftNow' : how === 'reps' ? 'reps' : how === 'assist' ? 'assist' : 'lift', n)
    const hold = (f: Finding): NarrativeItem => {
        const d = f.data
        const n = numbers(d)
        const lead = plan(d.how === 'reps' ? 'holdReps' : d.how === 'assist' ? 'holdAssist' : 'hold', n)
        return {
            findingId: f.id, action: lead,
            lines: [
                ...(d.altName ? [{ label: or, text: plan('holdAlt', { alt: name(d, 'alt') }) }] : []),
                { label: t('plan.stillHurts', {}), text: t('plan.seeSomeone', {}) },
            ],
        }
    }
    const next = findings.filter((f) => f.rule === 'next_session' && f.data.how !== 'deload')
    const nextItem = (): NarrativeItem => ({
        rule: 'next_session',
        action: t(findings.some((f) => f.rule === 'goal_path') ? 'plan.nextLeadGoal' : 'plan.nextLead', {}),
        lines: next.map((f) => {
            const n = numbers(f.data)
            const key = f.data.how === 'load_now' ? 'lineLoadNow' : f.data.how === 'reps' ? 'lineReps' : f.data.how === 'assist' ? 'lineAssist' : 'lineLoad'
            return { label: name(f.data), text: plan(key, n) }
        }),
    })
    const items: NarrativeItem[] = []
    for (const f of findings) {
        if (f.rule === 'goal_path') items.push(goal(f))
        else if (f.rule === 'pain_hold') items.push(hold(f))
        else if (f.rule === 'next_session' && f === next[0]) items.push(nextItem())
        else if (f.rule === 'few_days') items.push({ rule: 'few_days', action: plan('fewDays', { n: f.data.target, unit }) })
    }
    return items
}

/**
 * The line under an exercise on Today (progression.ts todayAim): how its aim moves on, since the
 * weight and reps themselves are in its summary; what the report decided for this period in the
 * report's own words.
 */
export function aimText(a: Aim, language: string, unit: 'week' | 'cycle', weightUnit: WeightUnit): string {
    const t = labelIn(language)
    // A weight and its unit stay on one line on a narrow phone
    const w = (kg: number | null) => `${toDisplayWeight(Number(kg), weightUnit)}\u00a0${weightUnit}`
    const n = { weight: w(a.weightKg), next: w(a.nextKg), assist: w(a.assistKg), low: String(a.low), top: String(a.top ?? ''), unit }
    switch (a.how) {
        case 'load': return t('plan.aimLoad', n)
        case 'step_up': return t('plan.aimStepUp', n)
        case 'reps': return t('plan.lineReps', n)
        case 'assist': return t('plan.aimAssist', n)
        case 'assist_down': return t('plan.aimAssistDown', n)
        case 'reset': return t('plan.aimReset', n)
        case 'hold': return t(a.assistKg != null ? 'plan.aimHoldAssist' : a.weightKg != null ? 'plan.aimHold' : 'plan.aimHoldReps', n)
        case 'lighter': {
            const values = { ...n, usual: w(a.usualKg), sets: String(a.sets), count: a.sets === 1 ? 'one' : 'other', usualSets: String(a.usualSets), usualCount: a.usualSets === 1 ? 'one' : 'other' }
            return t(a.assistKg != null ? 'plan.deloadAssist' : a.weightKg != null ? 'plan.deloadLoad' : 'plan.deloadReps', values)
        }
    }
}

/** A lighter week's numbers, a line for each main lift, from plan.ts deloadOf */
export function deloadLines(findings: Finding[], language: string, unit: 'week' | 'cycle', weightUnit: WeightUnit): NarrativeLine[] {
    const isZh = language === 'zh-TW'
    const t = labelIn(language)
    const w = (kg: unknown) => `${toDisplayWeight(Number(kg), weightUnit)} ${weightUnit}`
    return findings.filter((f) => f.rule === 'next_session' && f.data.how === 'deload').map((f) => {
        const d = f.data
        const key = d.assisted ? 'deloadAssist' : d.bodyweight ? 'deloadReps' : 'deloadLoad'
        const values = { weight: w(d.weightKg), usual: w(d.usualKg), assist: w(d.assistKg), low: String(d.low), sets: String(d.sets), count: Number(d.sets) === 1 ? 'one' : 'other', usualSets: String(d.usualSets), usualCount: Number(d.usualSets) === 1 ? 'one' : 'other', unit }
        return { label: String((isZh && d.nameZh) || d.name), text: t(`plan.${key}`, values) }
    })
}

/**
 * Every item in the order of the findings (by priority): the model's actions for its rules, and
 * the code's next-session items where their findings fall.
 */
export function withPlanItems(narrative: ReportNarrative, findings: Finding[], language: string, unit: 'week' | 'cycle', weightUnit: WeightUnit): ReportNarrative {
    const code = planItems(findings, language, unit, weightUnit)
    const lighter = deloadLines(findings, language, unit, weightUnit)
    const items: NarrativeItem[] = []
    const seen = new Set<string>()
    for (const f of findings) {
        if (CODE_RULES.has(f.rule)) {
            const item = code.find((i) => (i.findingId ? i.findingId === f.id : i.rule === f.rule))
            const key = item?.findingId ?? item?.rule
            if (item && key && !seen.has(key)) {
                seen.add(key)
                items.push(item)
            }
        } else if (!seen.has(f.rule)) {
            seen.add(f.rule)
            const own = narrative.items.find((i) => i.rule === f.rule)
            if (own) items.push(own.rule === 'deload' && lighter.length ? { ...own, lines: lighter } : own)
        }
    }
    return { ...narrative, items }
}
