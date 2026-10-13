import en from '../../messages/en.json'
import zh from '../../messages/zh-TW.json'
import { unitLabel } from './volume'
import type { Finding, ReportFacts, ReportNarrative, RuleId } from './types'

// The report's text in the app's own words (messages/*.json), for the report worker: the
// Chinese terms the model must use, and the text the report falls back to when the model's
// fails its checks twice.

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

/**
 * The report's text from the app's own labels: the status line as the headline, and each fired
 * rule's short advice with every item named, a low muscle's options in brackets. Plain, but always right, so a report whose text
 * failed its checks twice still arrives instead of failing.
 */
export function fallbackNarrative(facts: ReportFacts, findings: Finding[], language: string): ReportNarrative {
    const isZh = language === 'zh-TW'
    const t = (key: string, values: Record<string, string>) => formatLabel(String(messageAt(isZh ? zh : en, `reportV3.${key}`) ?? ''), values)
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const rules = [...new Set(findings.map((f) => f.rule))] as RuleId[]
    const nameOf = (f: Finding) => String((isZh && f.data.nameZh) || f.data.name || '')
    const muscleOf = (f: Finding) => (f.subject ? unitLabel(f.subject, language, (x) => x) : '')
    // A low muscle's ways to add sets, which its advice must offer
    const optionsOf = (f: Finding) => (['addTo', 'newExercise'] as const)
        .map((k) => (isZh ? f.data[`${k}Zh`] : null) ?? f.data[k])
        .filter((v): v is string => typeof v === 'string')
    const withOptions = (text: string, f: Finding) => {
        const options = optionsOf(f)
        return options.length ? `${text}${isZh ? `（${options.join('或')}）` : ` (${options.join(' or ')})`}` : text
    }
    const end = isZh ? '。' : '.'
    return {
        headline: `${t(`statusHint.${facts.status}`, { unit })}${end}`,
        items: rules.map((rule) => {
            const each = findings.filter((f) => f.rule === rule).map((f) => withOptions(t(`advised.${rule}`, { lift: nameOf(f), muscle: muscleOf(f), unit }), f))
            return { rule, action: `${[...new Set(each)].join(isZh ? '；' : '; ')}${end}` }
        }),
    }
}
