import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getClaudeClient } from '../claude'
import { toDisplayWeight, type WeightUnit } from '../../../../lib/weight-unit'
import { toDisplayDistance, type DistanceUnit } from '../../../../lib/distance-unit'
import { unitLabel, VOLUME_UNITS, VOLUME_UNIT_IDS } from '../../../../lib/report/volume'
import { fallbackNarrative, withLines, zhTermsLine } from '../../../../lib/report/report-text'
import type { CardioFacts, DayNote, Finding, FollowUp, LiftFacts, ReportFacts, ReportNarrative, RuleId, Watching } from './types'

// The model's whole job in the report: one headline, and one plain-language action for each
// rule code has already fired, covering every finding of that rule (all the muscles, all the
// lifts), so no advice is dropped. Low muscles are the exception: code writes that action and lists
// each muscle's ways to add sets under it (withLines), and the model adds only a sentence for a
// note that bears on them. Every number it may use
// is in the brief; it never sees raw sets, so it has nothing to recompute. Code decides the
// order: by priority, a deload first.

export const NARRATIVE_MODEL = 'claude-sonnet-4-6'
const MAX_ATTEMPTS = 2
/** One call's ceiling: a report takes about 35 s. The SDK's default is 10 minutes, far past the Lambda's 2. */
const REQUEST_TIMEOUT_MS = 60_000
/** Too little time left for a call to finish: stop, so the report is saved as failed instead of cut off */
const MIN_CALL_MS = 15_000

/** What each rule's advice says, in the user's unit. The app shows the research behind it. */
const advice = (unit: WeightUnit, period: string): Record<RuleId, string> => ({
    deload: 'Plan one lighter week: the same exercises at about half of each lift\'s sets this period (listed above) and clearly lighter weights, then build back up. If a note mentions sleep or stress, suggest looking at it; don\'t claim it is the cause.',
    lift_regressed: 'Stay at holdAt (this period\'s weight; for a bodyweight lift, the same reps) instead of adding load, check recovery (sleep, food, stress) and technique, and aim to get back to previousBest before pushing on.',
    lift_stalled: `Double progression: keep the weight and add reps on every set until all sets reach the top of the rep range, then add the smallest jump (${unit === 'lb' ? '5 lb upper body, 10 lb lower body' : '2.5 kg upper body, 5 kg lower body'}).`,
    low_volume: `It takes addSets more sets each ${period} to bring the muscle to 10 a week. Code writes this action: it tells the user to pick one way for each muscle and lists each muscle with its options (the exercises and sets in its data). Your text for low_volume is only for a note: if a note bears on a muscle or one of its options (pain, discomfort, missing equipment), one short sentence fitting the advice to it, naming the muscle, such as which option to prefer or a lighter start; otherwise an empty string. Add no exercise of your own unless a note rules out every option a muscle has.`,
    missed_sessions: 'Name the missed sessions and suggest a realistic way to fit those routines in, as planned, or plan around those days. Making them up is what brings lowGroups (muscles low only because of these sessions) back into range, so don\'t swap in other exercises. Never scold; if a note explains it, acknowledge that.',
    weight_trend: 'Body weight is moving against the goal: suggest a small daily calorie change (about 200-300 kcal) and steady weigh-ins, not a crash diet.',
    cardio_first: `On a lower-body day, do the leg lifts before the cardio (the cardio and lift in the data), or the cardio at another time; a 5-10 minute warm-up before lifting is fine. It is about leg strength: don't say cardio hurts muscle growth, and don't suggest doing more or less cardio.`,
})

/** Added to a lift rule's advice when one of its lifts is assisted, where less assist is the progress */
const ASSISTED_ADVICE: Partial<Record<RuleId, string>> = {
    lift_regressed: 'For an assisted lift, holdAt is the assist to stay at.',
    lift_stalled: 'For an assisted lift, keep the assist and add reps, then lower the assist by the smallest step.',
}

export interface NarrativeInput {
    facts: ReportFacts
    findings: Finding[]
    watching: Watching[]
    followUps: FollowUp[]
    /** The note for the whole period (period_notes, the way notes were written before day notes) */
    note: string | null
    /** Each day's note, already lined up with that day's plan and whether the user trained */
    dayNotes: DayNote[]
    language: string
    /** Weights are stored in kg; the brief, and so the text, uses the user's unit */
    weightUnit: WeightUnit
    /** Treadmill distance, in km or miles; km when not given */
    distanceUnit?: DistanceUnit
}

export interface NarrativeResult {
    narrative: ReportNarrative
    // For the eval runner: the exact prompt, and what it cost
    prompt: string
    model: string
    usage: Anthropic.Usage
    attempts: number
    /** Set when the model's text failed its checks on every attempt and the app's own labels were used: the last problems */
    fallback?: string
}

/** A finding's name, the way its action must name it: a muscle, a lift, or nothing (one per rule). */
export function findingName(f: Finding, language: string): string | null {
    if (f.rule === 'low_volume' && f.subject) return unitLabel(f.subject, language, (x) => x)
    if (f.rule === 'lift_stalled' || f.rule === 'lift_regressed') return String((language === 'zh-TW' && f.data.nameZh) || f.data.name)
    return null
}

/** Where withExerciseOptions puts a low muscle's options in its data */
const OPTION_FIELDS = ['addTo', 'addToZh', 'addToId', 'addToSets', 'addToHalf', 'newExercise', 'newExerciseZh', 'newExerciseId', 'newExerciseSets']
/** cardio_first's data, for the app; the brief has each session as a sentence instead (cardioFirstSessions) */
const CARDIO_FIRST_FIELDS = ['sessions', 'dates', 'date', 'routine', 'minutes', 'cardio', 'cardioZh', 'lift', 'liftZh']

/** The exercises a low muscle's action offers the user to choose between, as its action must name them. */
export function optionNames(f: Finding, language: string): string[] {
    if (f.rule !== 'low_volume') return []
    const zh = language === 'zh-TW'
    return (['addTo', 'newExercise'] as const)
        .map((k) => (zh ? f.data[`${k}Zh`] : null) ?? f.data[k])
        .filter((v): v is string => typeof v === 'string')
}

/** The fired rules, most important first (findings come sorted by priority). */
const rulesOf = (findings: Finding[]): RuleId[] => [...new Set(findings.map((f) => f.rule))]

/** Exactly one action per fired rule: the schema itself can't leave one out or add another. */
function schemaFor(findings: Finding[]) {
    return z.object({
        headline: z.string().describe('One sentence: the most important thing about this period.'),
        actions: z.object(Object.fromEntries(rulesOf(findings).map((r) => [r, z.string().describe(r === 'low_volume'
            ? 'Only a sentence fitting the low muscles\' options to a note that bears on them, or an empty string'
            : `What to do about ${r}, covering every item listed under it`)]))).strict(),
    })
}

const nameOf = (l: { name: string; nameZh: string | null }, zh: boolean) => (zh && l.nameZh ? l.nameZh : l.name)
/** How a lift's sets read: by reps alone, or with added weight on the body */
type SetKind = { bodyweight: boolean; added?: boolean }
function liftLine(l: LiftFacts, zh: boolean, unit: string, setOf: (s: LiftFacts['best'], kind: SetKind) => string): string {
    const trend = l.trend === 'new' ? 'no earlier data'
        : l.trend === 'flat' ? `flat (${l.flatWindows} ${unit}s without a new best)`
        : l.assisted ? `${l.trend} (less assist, or more reps at the same assist, is up)`
        : l.added ? `${l.trend} (more added weight, or more reps at the same weight, is up)`
        : l.bodyweight ? `best reps ${l.trend} ${Math.abs(l.change ?? 0)}` : `estimated 1RM ${l.trend} ${Math.abs(l.change ?? 0)}%`
    return `- ${nameOf(l, zh)}: ${setOf(l.best, l)} (last ${unit} ${setOf(l.previousBest, l)}), ${trend}, ${l.sets} sets this ${unit}${l.goalLift ? ', named in the goal' : ''}`
}

/** Cardio as the app shows it: a fact, with distance where the machine gives one. None at all says nothing. */
function cardioLine(c: CardioFacts | undefined, zh: boolean, unit: string, days: number, distanceUnit: DistanceUnit): string | null {
    if (!c || (!c.minutes && !c.previousPerWeek)) return null
    const scaled = days === 7 ? '' : ` (about ${c.perWeek} a week)`
    const last = c.previousPerWeek != null ? ` Last ${unit}: ${c.previousPerWeek} min${days === 7 ? '' : ' a week'}.` : ''
    const each = c.exercises.map((e) => {
        const distance = e.km != null ? `, ${toDisplayDistance(e.km, distanceUnit)} ${distanceUnit}` : e.metres != null ? `, ${e.metres} m` : ''
        return `${nameOf(e, zh)} ${e.minutes} min${distance}`
    })
    const what = c.minutes ? `${c.minutes} min${scaled} on ${c.days} ${c.days === 1 ? 'day' : 'days'}: ${each.join('; ')}.` : 'none.'
    return `Cardio this ${unit} (the app shows it as a fact; give no advice on how much cardio to do): ${what}${last}`
}

export function buildPrompt(input: NarrativeInput): string {
    const { facts, findings, watching, followUps, note, dayNotes, language, weightUnit, distanceUnit = 'km' } = input
    const zh = language === 'zh-TW'
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const w = (kg: number) => `${toDisplayWeight(kg, weightUnit)} ${weightUnit}`
    const assisted = (assistKg: number, reps: number | string) => `${reps} reps with ${w(assistKg)} assist`
    const bodyweightReps = (reps: number | string) => `${reps} reps (bodyweight)`
    const addedSet = (kg: number, reps: number | string) => (kg === 0 ? bodyweightReps(reps) : `+${w(kg)} x ${reps}`)
    const setOf = (s: LiftFacts['best'], kind: SetKind) => (!s ? '-' : s.assistKg != null ? assisted(s.assistKg, s.reps)
        : kind.added ? addedSet(s.weightKg, s.reps) : kind.bodyweight ? bodyweightReps(s.reps) : `${w(s.weightKg)} x ${s.reps}`)
    const ADVICE = advice(weightUnit, unit)
    // Finding data keeps weights in kg ("82.5x8"); the model sees the user's unit. previousValue
    // is an internal estimated 1RM for the follow-up, not something to quote. In a 7-day period
    // perWeek is the same number as sets, and two names for one number read as two numbers.
    // A low muscle's options go in as phrases (optionsOf), not as their fields.
    const hidden = new Set(['previousValue', ...OPTION_FIELDS, ...(facts.period.days === 7 ? ['perWeek'] : [])])
    const hiddenFor = (f: Finding) => (f.rule === 'cardio_first' ? new Set([...hidden, ...CARDIO_FIRST_FIELDS]) : hidden)
    // Muscles by name, in the user's language like exercise names
    const muscleName = (g: string) => unitLabel(g, language, (x) => x)
    // Spelled out so "4 more sets" can't be read as "4 sets in all"; a missing option is left out
    const optionsOf = (f: Finding) => {
        const d = f.data
        const name = (k: 'addTo' | 'newExercise') => String((zh && d[`${k}Zh`]) || d[k])
        return [
            d.addTo != null && `${d.addToSets} more ${d.addToSets === 1 ? 'set' : 'sets'} each ${unit} of ${name('addTo')}, on top of the sets they do now${d.addToHalf ? ` (it trains the ${muscleName(String(f.subject))} only as a secondary muscle${zh ? ', 順帶練到' : ''}, so each set counts half; say so)` : ''}`,
            d.newExercise != null && `add ${name('newExercise')}, a new exercise, for ${d.newExerciseSets} sets each ${unit}`,
        ].filter(Boolean)
    }
    // Each session as a sentence that says the cardio came first: given "minutes: 20" and one
    // day's routine, the model wrote that the cardio came after the squat, and that only one of
    // two leg days was a leg day (v7)
    const cardioFirstSessions = (f: Finding) => {
        const dates = String(f.data.dates ?? '').split(', ')
        return (facts.cardio?.legSessions ?? []).filter((x) => dates.includes(x.date) && x.cardio).map((x) =>
            `${x.date}${x.routine ? ` (${x.routine})` : ''}: ${x.minutesBefore} min of ${nameOf(x.cardio!, zh)} logged before the first leg lift, ${nameOf(x.lift, zh)}`)
    }
    const dataFor = (f: Finding) => Object.fromEntries([
        ...(f.rule === 'low_volume' && f.subject ? [['muscle', muscleName(f.subject)], ['options', optionsOf(f)]] : []),
        ...(f.rule === 'cardio_first' ? [['sessions', cardioFirstSessions(f)]] : []),
        ...(f.rule === 'lift_regressed' && !f.data.bodyweight && typeof f.data.best === 'string' && !(f.data.added && Number(f.data.best.split('x')[0]) === 0)
            ? [['holdAt', `${f.data.added ? '+' : ''}${w(Number(f.data.best.split('x')[0]))}${f.data.assisted ? ' assist' : f.data.added ? ' added' : ''}`]] : []),
        ...Object.entries(f.data).filter(([k]) => !hiddenFor(f).has(k)).map(([k, v]) => {
            const m = typeof v === 'string' && /^(\d+(?:\.\d+)?)x(\d+)$/.exec(v)
            if (m) return [k, f.data.assisted ? assisted(Number(m[1]), m[2]) : f.data.added ? addedSet(Number(m[1]), m[2]) : f.data.bodyweight ? bodyweightReps(m[2]) : `${w(Number(m[1]))} x ${m[2]}`]
            if (k === 'lowGroups' && typeof v === 'string') return [k, v.split(', ').map(muscleName).join(', ')]
            return [k.replace(/Kg$/, ''), (k === 'latestKg' || k === 'changeKg') && typeof v === 'number' ? w(v) : v]
        }),
    ])
    // Each note's day as the log has it, so the model reads which day it was instead of working it out
    const dayOf = (d: DayNote) => {
        const trained = d.trained ? 'trained' : 'not trained'
        if (facts.sessions.planned == null) return trained
        return d.routine ? `${d.routine}, ${trained}` : `rest day${d.trained ? ', trained' : ''}`
    }
    const ranged = VOLUME_UNIT_IDS.filter((u) => VOLUME_UNITS[u].target).map(muscleName).join(', ')
    // The body weight change is against the last period with weigh-ins, which may be further back
    const since = (back: number) => (back === 1 ? `vs last ${unit}` : `vs ${back} ${unit}s ago`)
    // Follow-ups and watched items by name, as the app shows them: the model can't name a lift from its id
    const nameIn = (rule: RuleId, subject: string | null, d: FollowUp['data']) =>
        rule === 'low_volume' && subject ? muscleName(subject) : d.name ? String((zh && d.nameZh) || d.name) : null
    const followUpLine = (f: FollowUp) => {
        const name = nameIn(f.rule, f.subject, f.data)
        const why = f.data.weighIns === 0 ? `, no weigh-in this ${unit} to tell` : f.data.noPlan ? `, no plan this ${unit} to count against`
            : f.data.legSessions === 0 ? `, no leg day this ${unit}` : f.data.trained === 0 ? `, not trained this ${unit}` : ''
        return `- ${f.rule}${name ? ` (${name})` : ''}: ${f.status}${why}`
    }
    const s = facts.liftsSummary
    const lines = [
        `Period: ${facts.period.start} to ${facts.period.end} (one ${unit}, ${facts.period.days} days).`,
        `Status, decided by code: ${facts.status} (main lifts: ${s.up} up, ${s.flat} flat, ${s.down} down).`,
        `Sessions: ${facts.sessions.done}${facts.sessions.planned != null ? ` of ${facts.sessions.planned} planned` : ''}. Sets: ${facts.totalSets.now}${facts.totalSets.previous != null ? ` (last ${unit} ${facts.totalSets.previous})` : ''}.`,
        `Main lifts, best set this ${unit}:`,
        ...facts.lifts.map((l) => liftLine(l, zh, unit, setOf)),
        facts.records.length ? `New records (best estimated 1RM so far; not necessarily a new weight): ${facts.records.map((r) => `${nameOf(r, zh)} ${setOf(r.best, r)}`).join('; ')}.` : 'No new records.',
        `${facts.period.days === 7 ? 'Sets per muscle this week' : `Sets per muscle per week (this ${facts.period.days}-day cycle scaled to 7 days)`}, where a muscle an exercise trains on the side counts half a set (range 10-20 a week for ${ranged}; the others have no range): ${facts.muscles.map((m) => {
            const notes = [m.status === 'low' ? 'below the range' : m.status === 'high' ? 'above the range' : null, m.previousPerWeek != null ? `last ${unit} ${m.previousPerWeek}` : null].filter(Boolean)
            return `${muscleName(m.group)} ${m.perWeek}${notes.length ? ` (${notes.join('; ')})` : ''}`
        }).join(', ')}.`,
        cardioLine(facts.cardio, zh, unit, facts.period.days, distanceUnit),
        facts.bodyWeight.latestKg != null ? `Body weight: ${w(facts.bodyWeight.latestKg)}${facts.bodyWeight.changeKg != null ? ` (${facts.bodyWeight.changeKg >= 0 ? '+' : '-'}${w(Math.abs(facts.bodyWeight.changeKg))} ${since(facts.bodyWeight.changeWindows ?? 1)})` : ''}, ${facts.bodyWeight.weighIns} weigh-in(s) this ${unit}.` : 'No body weight logged.',
        `Weights are in ${weightUnit}; write every weight in ${weightUnit}.`,
        `The user's goal: ${facts.goal.text ? `"${facts.goal.text}"` : 'not set'}.`,
        `The user's note for this ${unit} (context to fit the advice to, not a message that needs a reply): ${note ? `"${note}"` : 'none'}.`,
        ...(dayNotes.length ? [
            `The user's notes on single days, each after that day's plan and whether they trained (context too, not messages that need a reply):`,
            ...dayNotes.map((d) => `- ${d.date} (${dayOf(d)}): ${JSON.stringify(d.note)}`),
        ] : []),
    ].filter((line): line is string => line != null)
    if (followUps.length) {
        lines.push(`Last report's advice and how it went (the app shows this; mention it in the headline only if it matters):`,
            ...followUps.map(followUpLine))
    }
    const itemName = (f: Finding) => findingName(f, language)
    lines.push(findings.length
        ? `Rules that fired, most important first; each has one or more items:\n${rulesOf(findings).map((r) => {
            const fs = findings.filter((f) => f.rule === r)
            const advice = fs.some((f) => f.data.assisted) && ASSISTED_ADVICE[r] ? `${ADVICE[r]} ${ASSISTED_ADVICE[r]}` : ADVICE[r]
            return `- ${r} (priority ${Math.max(...fs.map((f) => f.priority))}). Advice: ${advice}\n${fs.map((f) => `    - ${itemName(f) ? `${itemName(f)}: ` : ''}data ${JSON.stringify(dataFor(f))}`).join('\n')}`
        }).join('\n')}`
        : 'No rules fired this period.')
    if (watching.length) lines.push(`Watching, below threshold (do not advise on these): ${watching.map((x) => `${x.rule}${nameIn(x.rule, x.subject, x.data) ? ` (${nameIn(x.rule, x.subject, x.data)})` : ''}`).join(', ')}.`)

    const lowFired = findings.some((f) => f.rule === 'low_volume')
    const languageRule = zh
        ? `Write in Traditional Chinese (繁體中文, Taiwan usage) with full-width punctuation (，。！？「」), and use the Chinese exercise and muscle names given above. ${zhTermsLine()}`
        : 'Write in English.'
    return `You write the short text of a strength-training app's weekly report. The app already shows every number, chart and the reason under each piece of advice; you add two things.

${lines.join('\n')}

1. headline: one sentence the user reads first, the most important thing about this ${unit}, consistent with the status. It may use a number from above. ${zh ? 'At most 40 characters.' : 'At most 25 words.'}
2. actions: ${findings.length ? `one for each rule above. Each says exactly what to do next ${unit} about every item under its rule, naming each one as written above (every muscle, every lift), with the exercise, sets, weights or reps from the data; as short as covering every item allows. Don't repeat the reason; the app shows it. Fit every action to the user's notes: if one mentions pain or discomfort in a movement or joint, don't simply add sets or load there; suggest a pain-free alternative or a lighter range, and getting it checked if it persists.${lowFired ? ` low_volume is the exception: code writes its action and lists its muscles and options, so its text is only the note sentence its advice describes, or an empty string${zh ? ` (at most ${LOW_VOLUME_NOTE_MAX.zh} characters)` : ` (at most ${LOW_VOLUME_NOTE_MAX.en} words)`}.` : ''}` : 'leave it empty: nothing fired, so give no advice.'}

Use only the numbers above; never invent data. No myths, no diagnosis, no scolding. Plain text only: no Markdown, no lists inside a field. ${languageRule}`
}

// What a report's text must not do, checked before it is saved. The same lines as the eval's
// programmatic grade (evals/report-v3/grade.mjs), so a text that passes here passes there.
const SIMPLIFIED_ONLY = /[这们训练进动议还时对说体发让点从过关应经]/g
const HALF_WIDTH_AFTER_CJK = /[一-鿿][,?!:;]/
const MARKDOWN = /\*\*|__|`|^\s*#|^\s*[-*]\s|^\s*\d+\.\s/m
const WRONG_UNIT: Record<WeightUnit, RegExp> = { kg: /\d\s*(lbs?|磅)/i, lb: /\d\s*(kg|公斤)/i }
const HEADLINE_MAX = { zh: 45, en: 30 }
/** The model's sentence for a note on a low muscle's options, after the lead code writes */
export const LOW_VOLUME_NOTE_MAX = { zh: 50, en: 30 }

/** Each problem with a report's text, in words the retry can act on; empty when it is fine */
export function textProblems(n: ReportNarrative, input: NarrativeInput): string[] {
    const zh = input.language === 'zh-TW'
    const text = [n.headline, ...n.items.map((i) => i.action)].join('\n')
    const problems: string[] = []
    const cjk = (text.match(/[一-鿿]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    const cjkShare = cjk / Math.max(1, cjk + latin)
    if (zh && cjkShare <= 0.5) problems.push('it is not written in Traditional Chinese')
    if (zh && (text.match(SIMPLIFIED_ONLY) ?? []).length > 2) problems.push('it uses Simplified Chinese characters; use Traditional ones')
    const half = zh && HALF_WIDTH_AFTER_CJK.exec(text)
    if (half) problems.push(`it has half-width punctuation after Chinese ("${half[0]}"); use full-width ，？！：；`)
    if (!zh && cjkShare >= 0.05) problems.push('it is not written in English')
    if (MARKDOWN.test(text)) problems.push('it has Markdown; write plain text')
    if (WRONG_UNIT[input.weightUnit].test(text)) problems.push(`it has a weight in ${input.weightUnit === 'kg' ? 'lb' : 'kg'}; write every weight in ${input.weightUnit}`)
    const length = zh ? [...n.headline.replace(/\s/g, '')].length : n.headline.split(/\s+/).filter(Boolean).length
    const max = zh ? HEADLINE_MAX.zh : HEADLINE_MAX.en
    if (length > max) problems.push(`the headline is ${length} ${zh ? 'characters' : 'words'}; keep it to ${max}`)
    // The model's low_volume text is one sentence for a note: code writes the rest
    const note = n.items.find((i) => i.rule === 'low_volume')?.action
    if (note) {
        const noteLength = zh ? [...note.replace(/\s/g, '')].length : note.split(/\s+/).filter(Boolean).length
        const noteMax = zh ? LOW_VOLUME_NOTE_MAX.zh : LOW_VOLUME_NOTE_MAX.en
        if (noteLength > noteMax) problems.push(`the low_volume text is ${noteLength} ${zh ? 'characters' : 'words'}; keep it to one sentence of at most ${noteMax}, only for a note: code lists the muscles and their options`)
    }
    // Every other item named in its rule's action
    for (const f of input.findings) {
        if (f.rule === 'low_volume') continue
        const action = (n.items.find((i) => i.rule === f.rule)?.action ?? '').toLowerCase()
        for (const name of [findingName(f, input.language)]) {
            if (name && !action.includes(name.toLowerCase())) problems.push(`the ${f.rule} action doesn't name ${name}`)
        }
    }
    return problems
}

export interface NarrativeOptions {
    /** When the caller must be done (epoch ms): each call is cut off by then, SDK retries included */
    deadline?: number
    /** For tests; the SSM-keyed client otherwise */
    client?: Pick<Anthropic, 'messages'>
}

export async function generateNarrative(input: NarrativeInput, model: string = NARRATIVE_MODEL, options: NarrativeOptions = {}): Promise<NarrativeResult> {
    const { deadline } = options
    const client = options.client ?? await getClaudeClient()
    const schema = schemaFor(input.findings)
    const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(schema)
    const prompt = buildPrompt(input)
    const usage = { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage
    let lastProblem = ''
    // The model that answered last; a text the checks turned down is still an answer
    let answeredBy: string | null = null
    // The checks' problems with the last text, which the next attempt is asked to fix
    let feedback = ''

    // A failed report still reports its brief and what the attempts used, for its trace
    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const startedAt = Date.now()
            const left = deadline == null ? Infinity : deadline - startedAt
            if (left < MIN_CALL_MS) {
                if (answeredBy) break
                throw new Error(`Out of time before attempt ${attempt} (${Math.max(0, Math.round(left / 1000))} s left)`)
            }
            const response = await client.messages.create({
                model,
                max_tokens: 1024,
                tools: [{ name: 'submit_report_text', description: 'Submit the headline and advice for the report.', input_schema: inputSchema as Anthropic.Tool.InputSchema }],
                tool_choice: { type: 'tool', name: 'submit_report_text' },
                messages: [{ role: 'user', content: feedback ? `${prompt}\n\nAn earlier answer had these problems; write it again without them, keeping what was right: ${feedback}` : prompt }],
            }, {
                timeout: Math.min(REQUEST_TIMEOUT_MS, left),
                // The SDK retries a timeout or an overloaded API by itself; this ends them all by the deadline
                ...(deadline == null ? {} : { signal: AbortSignal.timeout(left) }),
            })
            usage.input_tokens += response.usage.input_tokens
            usage.output_tokens += response.usage.output_tokens
            console.log(JSON.stringify({
                event: 'claude_call', model: response.model, attempt, stopReason: response.stop_reason,
                inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, durationMs: Date.now() - startedAt,
            }))
            answeredBy = response.model
            feedback = ''

            const block = response.content.find((b) => b.type === 'tool_use')
            const parsed = block?.type === 'tool_use' ? schema.safeParse(block.input) : null
            if (response.stop_reason === 'max_tokens') lastProblem = `the response hit max_tokens (${response.usage.output_tokens} output tokens)`
            else if (!parsed) lastProblem = 'no tool_use block in the response'
            else if (!parsed.success) lastProblem = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
            else {
                const { headline, actions } = parsed.data as { headline: string; actions: Record<string, string> }
                // The low_volume text is only for a note: without one, whatever was written there is
                // dropped (in v13 it said there was no note, and that "the code" listed the options)
                const noted = !!input.note || input.dayNotes.length > 0
                const narrative: ReportNarrative = { headline, items: rulesOf(input.findings).map((rule) => ({ rule, action: rule === 'low_volume' && !noted ? '' : actions[rule] })) }
                // A low_volume text is empty without a note that bears on it
                const problems = headline.trim() && narrative.items.every((i) => i.rule === 'low_volume' || i.action?.trim()) ? textProblems(narrative, input) : ['empty text']
                if (!problems.length) return { narrative: withLines(narrative, input.findings, input.language, input.facts.period.days === 7 ? 'week' : 'cycle'), prompt, model: response.model, usage, attempts: attempt }
                lastProblem = problems.join('; ')
                feedback = lastProblem
            }
            console.warn(JSON.stringify({ event: 'claude_invalid_output', model: response.model, attempt, problem: lastProblem }))
        }
        // The model answered, but no answer passed: the app's own labels, so the report still
        // arrives. Its trace keeps why.
        if (answeredBy) {
            console.warn(JSON.stringify({ event: 'report_text_fallback', model: answeredBy, problem: lastProblem }))
            return { narrative: fallbackNarrative(input.facts, input.findings, input.language), prompt, model: answeredBy, usage, attempts: MAX_ATTEMPTS, fallback: lastProblem }
        }
        throw new Error(`Claude returned no report: ${lastProblem}`)
    } catch (err) {
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { usage, prompt })
    }
}
