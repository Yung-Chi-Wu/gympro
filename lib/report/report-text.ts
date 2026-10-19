import en from '../../messages/en.json'
import zh from '../../messages/zh-TW.json'
import { unitLabel } from './volume'
import type { Finding, NarrativeLine, ReportFacts, ReportNarrative, RuleId } from './types'

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
 * 2026-10-18), so code lists them and the action is a short lead.
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

/** Each action with the lines code writes under it: a low_volume action gets one per muscle */
export function withLines(narrative: ReportNarrative, findings: Finding[], language: string, unit: 'week' | 'cycle'): ReportNarrative {
    return {
        ...narrative,
        items: narrative.items.map((i) => (i.rule === 'low_volume' ? { ...i, lines: optionLines(findings, language, unit) } : i)),
    }
}

/**
 * The report's text from the app's own labels: the status line as the headline, and each fired
 * rule's short advice with every item named; a low muscle's options are its lines. Plain, but
 * always right, so a report whose text failed its checks twice still arrives instead of failing.
 */
export function fallbackNarrative(facts: ReportFacts, findings: Finding[], language: string): ReportNarrative {
    const isZh = language === 'zh-TW'
    const t = labelIn(language)
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const rules = [...new Set(findings.map((f) => f.rule))] as RuleId[]
    const nameOf = (f: Finding) => String((isZh && f.data.nameZh) || f.data.name || '')
    const muscleOf = (f: Finding) => (f.subject ? unitLabel(f.subject, language, (x) => x) : '')
    const end = isZh ? '。' : '.'
    return withLines({
        headline: `${t(`statusHint.${facts.status}`, { unit })}${end}`,
        items: rules.map((rule) => {
            if (rule === 'low_volume') return { rule, action: t('options.lead', {}) }
            const each = findings.filter((f) => f.rule === rule).map((f) => t(`advised.${rule}`, { lift: nameOf(f), muscle: muscleOf(f), unit }))
            return { rule, action: `${[...new Set(each)].join(isZh ? '；' : '; ')}${end}` }
        }),
    }, findings, language, unit)
}
