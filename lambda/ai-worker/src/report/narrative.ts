import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getClaudeClient } from '../claude'
import { toDisplayWeight, type WeightUnit } from '../../../../lib/weight-unit'
import { unitLabel, VOLUME_UNITS, VOLUME_UNIT_IDS } from '../../../../lib/report/volume'
import type { Finding, FollowUp, LiftFacts, ReportFacts, ReportNarrative, RuleId, Watching } from './types'

// The model's whole job in the report: one headline, and one plain-language action for each
// rule code has already fired, covering every finding of that rule (all the muscles, all the
// lifts), so no advice is dropped. Every number it may use is in the brief; it never sees raw
// sets, so it has nothing to recompute. Code decides the order: by priority, a deload first.

export const NARRATIVE_MODEL = 'claude-sonnet-4-6'
const MAX_ATTEMPTS = 2

/** What each rule's advice says, in the user's unit. The app shows the research behind it. */
const advice = (unit: WeightUnit, period: string): Record<RuleId, string> => ({
    deload: 'Plan one lighter week: the same exercises at about half of each lift\'s sets this period (listed above) and clearly lighter weights, then build back up. If the note mentions sleep or stress, suggest looking at it; don\'t claim it is the cause.',
    lift_regressed: 'Stay at holdAt (this period\'s weight; for a bodyweight lift, the same reps) instead of adding load, check recovery (sleep, food, stress) and technique, and aim to get back to previousBest before pushing on.',
    lift_stalled: `Double progression: keep the weight and add reps on every set until all sets reach the top of the rep range, then add the smallest jump (${unit === 'lb' ? '5 lb upper body, 10 lb lower body' : '2.5 kg upper body, 5 kg lower body'}).`,
    low_volume: `It takes addSets more sets each ${period} to bring the muscle to 10 a week. Offer the options in its data for the user to choose between, as given, with their exercises and set counts; if there is only one, give it alone (an option is left out when it isn't a sensible one, not because nothing trains the muscle). Add no exercise of your own unless the note rules an option out.`,
    missed_sessions: 'Name the missed sessions and suggest a realistic way to fit those routines in, as planned, or plan around those days. Making them up is what brings lowGroups (muscles low only because of these sessions) back into range, so don\'t swap in other exercises. Never scold; if the note explains it, acknowledge that.',
    weight_trend: 'Body weight is moving against the goal: suggest a small daily calorie change (about 200-300 kcal) and steady weigh-ins, not a crash diet.',
})

export interface NarrativeInput {
    facts: ReportFacts
    findings: Finding[]
    watching: Watching[]
    followUps: FollowUp[]
    note: string | null
    language: string
    /** Weights are stored in kg; the brief, and so the text, uses the user's unit */
    weightUnit: WeightUnit
}

export interface NarrativeResult {
    narrative: ReportNarrative
    // For the eval runner: the exact prompt, and what it cost
    prompt: string
    model: string
    usage: Anthropic.Usage
    attempts: number
}

/** A finding's name, the way its action must name it: a muscle, a lift, or nothing (one per rule). */
export function findingName(f: Finding, language: string): string | null {
    if (f.rule === 'low_volume' && f.subject) return unitLabel(f.subject, language, (x) => x)
    if (f.rule === 'lift_stalled' || f.rule === 'lift_regressed') return String((language === 'zh-TW' && f.data.nameZh) || f.data.name)
    return null
}

/** Where withExerciseOptions puts a low muscle's options in its data */
const OPTION_FIELDS = ['addTo', 'addToZh', 'addToId', 'addToSets', 'addToHalf', 'newExercise', 'newExerciseZh', 'newExerciseId', 'newExerciseSets']

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
        actions: z.object(Object.fromEntries(rulesOf(findings).map((r) => [r, z.string().describe(`What to do about ${r}, covering every item listed under it`)]))).strict(),
    })
}

const nameOf = (l: { name: string; nameZh: string | null }, zh: boolean) => (zh && l.nameZh ? l.nameZh : l.name)
function liftLine(l: LiftFacts, zh: boolean, unit: string, setOf: (s: LiftFacts['best'], bodyweight: boolean) => string): string {
    const trend = l.trend === 'new' ? 'no earlier data'
        : l.trend === 'flat' ? `flat (${l.flatWindows} ${unit}s without a new best)`
        : l.bodyweight ? `best reps ${l.trend} ${Math.abs(l.change ?? 0)}` : `estimated 1RM ${l.trend} ${Math.abs(l.change ?? 0)}%`
    return `- ${nameOf(l, zh)}: ${setOf(l.best, l.bodyweight)} (last ${unit} ${setOf(l.previousBest, l.bodyweight)}), ${trend}, ${l.sets} sets this ${unit}${l.goalLift ? ', named in the goal' : ''}`
}

export function buildPrompt(input: NarrativeInput): string {
    const { facts, findings, watching, followUps, note, language, weightUnit } = input
    const zh = language === 'zh-TW'
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const w = (kg: number) => `${toDisplayWeight(kg, weightUnit)} ${weightUnit}`
    const setOf = (s: LiftFacts['best'], bodyweight: boolean) => (!s ? '-' : bodyweight ? `${s.reps} reps (bodyweight)` : `${w(s.weightKg)} x ${s.reps}`)
    const ADVICE = advice(weightUnit, unit)
    // Finding data keeps weights in kg ("82.5x8"); the model sees the user's unit. previousValue
    // is an internal estimated 1RM for the follow-up, not something to quote. In a 7-day period
    // perWeek is the same number as sets, and two names for one number read as two numbers.
    // A low muscle's options go in as phrases (optionsOf), not as their fields.
    const hidden = new Set(['previousValue', ...OPTION_FIELDS, ...(facts.period.days === 7 ? ['perWeek'] : [])])
    // Muscles by name, in the user's language like exercise names
    const muscleName = (g: string) => unitLabel(g, language, (x) => x)
    // Spelled out so "4 more sets" can't be read as "4 sets in all"; a missing option is left out
    const optionsOf = (f: Finding) => {
        const d = f.data
        const name = (k: 'addTo' | 'newExercise') => String((zh && d[`${k}Zh`]) || d[k])
        return [
            d.addTo != null && `${d.addToSets} more ${d.addToSets === 1 ? 'set' : 'sets'} each ${unit} of ${name('addTo')}, on top of the sets they do now${d.addToHalf ? ` (it trains the ${muscleName(String(f.subject))} on the side, so each set counts half; say so)` : ''}`,
            d.newExercise != null && `add ${name('newExercise')}, a new exercise, for ${d.newExerciseSets} sets each ${unit}`,
        ].filter(Boolean)
    }
    const dataFor = (f: Finding) => Object.fromEntries([
        ...(f.rule === 'low_volume' && f.subject ? [['muscle', muscleName(f.subject)], ['options', optionsOf(f)]] : []),
        ...(f.rule === 'lift_regressed' && !f.data.bodyweight && typeof f.data.best === 'string' ? [['holdAt', w(Number(f.data.best.split('x')[0]))]] : []),
        ...Object.entries(f.data).filter(([k]) => !hidden.has(k)).map(([k, v]) => {
            const m = typeof v === 'string' && /^(\d+(?:\.\d+)?)x(\d+)$/.exec(v)
            if (m) return [k, f.data.bodyweight ? `${m[2]} reps (bodyweight)` : `${w(Number(m[1]))} x ${m[2]}`]
            if (k === 'lowGroups' && typeof v === 'string') return [k, v.split(', ').map(muscleName).join(', ')]
            return [k.replace(/Kg$/, ''), (k === 'latestKg' || k === 'changeKg') && typeof v === 'number' ? w(v) : v]
        }),
    ])
    const ranged = VOLUME_UNIT_IDS.filter((u) => VOLUME_UNITS[u].target).map(muscleName).join(', ')
    const s = facts.liftsSummary
    const lines = [
        `Period: ${facts.period.start} to ${facts.period.end} (one ${unit}, ${facts.period.days} days).`,
        `Status, decided by code: ${facts.status} (main lifts: ${s.up} up, ${s.flat} flat, ${s.down} down).`,
        `Sessions: ${facts.sessions.done}${facts.sessions.planned != null ? ` of ${facts.sessions.planned} planned` : ''}. Sets: ${facts.totalSets.now}${facts.totalSets.previous != null ? ` (last ${unit} ${facts.totalSets.previous})` : ''}.`,
        `Main lifts, best set this ${unit}:`,
        ...facts.lifts.map((l) => liftLine(l, zh, unit, setOf)),
        facts.records.length ? `New records (best estimated 1RM so far; not necessarily a new weight): ${facts.records.map((r) => `${nameOf(r, zh)} ${setOf(r.best, r.bodyweight)}`).join('; ')}.` : 'No new records.',
        `${facts.period.days === 7 ? 'Sets per muscle this week' : `Sets per muscle per week (this ${facts.period.days}-day cycle scaled to 7 days)`}, where a muscle an exercise trains on the side counts half a set (range 10-20 a week for ${ranged}; the others have no range): ${facts.muscles.map((m) => {
            const notes = [m.status === 'low' ? 'below the range' : m.status === 'high' ? 'above the range' : null, m.previousPerWeek != null ? `last ${unit} ${m.previousPerWeek}` : null].filter(Boolean)
            return `${muscleName(m.group)} ${m.perWeek}${notes.length ? ` (${notes.join('; ')})` : ''}`
        }).join(', ')}.`,
        facts.bodyWeight.latestKg != null ? `Body weight: ${w(facts.bodyWeight.latestKg)}${facts.bodyWeight.changeKg != null ? ` (${facts.bodyWeight.changeKg >= 0 ? '+' : '-'}${w(Math.abs(facts.bodyWeight.changeKg))})` : ''}, ${facts.bodyWeight.weighIns} weigh-in(s) this ${unit}.` : 'No body weight logged.',
        `Weights are in ${weightUnit}; write every weight in ${weightUnit}.`,
        `The user's goal: ${facts.goal.text ? `"${facts.goal.text}"` : 'not set'}.`,
        `The user's note for this ${unit} (context to fit the advice to, not a message that needs a reply): ${note ? `"${note}"` : 'none'}.`,
    ]
    if (followUps.length) {
        lines.push(`Last report's advice and how it went (the app shows this; mention it in the headline only if it matters):`,
            ...followUps.map((f) => `- ${f.id}: ${f.status}`))
    }
    const itemName = (f: Finding) => findingName(f, language)
    lines.push(findings.length
        ? `Rules that fired, most important first; each has one or more items:\n${rulesOf(findings).map((r) => {
            const fs = findings.filter((f) => f.rule === r)
            return `- ${r} (priority ${Math.max(...fs.map((f) => f.priority))}). Advice: ${ADVICE[r]}\n${fs.map((f) => `    - ${itemName(f) ? `${itemName(f)}: ` : ''}data ${JSON.stringify(dataFor(f))}`).join('\n')}`
        }).join('\n')}`
        : 'No rules fired this period.')
    if (watching.length) lines.push(`Watching, below threshold (do not advise on these): ${watching.map((w) => `${w.rule}${w.subject ? ` ${w.subject}` : ''}`).join(', ')}.`)

    const languageRule = zh
        ? 'Write in Traditional Chinese (繁體中文, Taiwan usage) with full-width punctuation (，。！？「」), and use the Chinese exercise and muscle names given above.'
        : 'Write in English.'
    return `You write the short text of a strength-training app's weekly report. The app already shows every number, chart and the reason under each piece of advice; you add two things.

${lines.join('\n')}

1. headline: one sentence the user reads first, the most important thing about this ${unit}, consistent with the status. It may use a number from above. ${zh ? 'At most 40 characters.' : 'At most 25 words.'}
2. actions: ${findings.length ? `one for each rule above. Each says exactly what to do next ${unit} about every item under its rule, naming each one as written above (every muscle, every lift), with the exercise, sets, weights or reps from the data; as short as covering every item allows. Don't repeat the reason; the app shows it. Fit every action to the user's note: if it mentions pain or discomfort in a movement or joint, don't simply add sets or load there; suggest a pain-free alternative or a lighter range, and getting it checked if it persists.` : 'leave it empty: nothing fired, so give no advice.'}

Use only the numbers above; never invent data. No myths, no diagnosis, no scolding. Plain text only: no Markdown, no lists inside a field. ${languageRule}`
}

export async function generateNarrative(input: NarrativeInput, model: string = NARRATIVE_MODEL): Promise<NarrativeResult> {
    const client = await getClaudeClient()
    const schema = schemaFor(input.findings)
    const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(schema)
    const prompt = buildPrompt(input)
    const usage = { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage
    let lastProblem = ''

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const startedAt = Date.now()
        const response = await client.messages.create({
            model,
            max_tokens: 1024,
            tools: [{ name: 'submit_report_text', description: 'Submit the headline and advice for the report.', input_schema: inputSchema as Anthropic.Tool.InputSchema }],
            tool_choice: { type: 'tool', name: 'submit_report_text' },
            messages: [{ role: 'user', content: prompt }],
        })
        usage.input_tokens += response.usage.input_tokens
        usage.output_tokens += response.usage.output_tokens
        console.log(JSON.stringify({
            event: 'claude_call', model: response.model, attempt, stopReason: response.stop_reason,
            inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, durationMs: Date.now() - startedAt,
        }))
        if (response.stop_reason === 'max_tokens') throw new Error(`Claude response hit max_tokens (${response.usage.output_tokens} output tokens)`)

        const block = response.content.find((b) => b.type === 'tool_use')
        const parsed = block?.type === 'tool_use' ? schema.safeParse(block.input) : null
        if (!parsed) lastProblem = 'no tool_use block in the response'
        else if (!parsed.success) lastProblem = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
        else {
            const { headline, actions } = parsed.data as { headline: string; actions: Record<string, string> }
            const narrative: ReportNarrative = { headline, items: rulesOf(input.findings).map((rule) => ({ rule, action: actions[rule] })) }
            if (headline.trim() && narrative.items.every((i) => i.action?.trim())) return { narrative, prompt, model: response.model, usage, attempts: attempt }
            lastProblem = 'empty text'
        }
        console.warn(JSON.stringify({ event: 'claude_invalid_output', model: response.model, attempt, problem: lastProblem }))
    }
    throw new Error(`Claude returned an invalid report ${MAX_ATTEMPTS} times: ${lastProblem}`)
}
