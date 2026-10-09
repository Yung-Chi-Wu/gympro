import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { getClaudeClient } from '../claude'
import { toDisplayWeight, type WeightUnit } from '../../../../lib/weight-unit'
import type { Finding, FollowUp, LiftFacts, ReportFacts, ReportNarrative, RuleId, Watching } from './types'

// The model's whole job in the report: one headline, and plain-language advice for at
// most three of the rules code has already fired. Every number it may use is in the
// brief; it never sees raw sets, so it has nothing to recompute.

export const NARRATIVE_MODEL = 'claude-sonnet-4-6'
const MAX_ITEMS = 3
const MAX_ATTEMPTS = 2

/** What each rule's advice says, in the user's unit. The app shows the research behind it. */
const advice = (unit: WeightUnit): Record<RuleId, string> => ({
    deload: 'Plan one lighter week: the same exercises at about half of each lift\'s sets this period (listed above) and clearly lighter weights, then build back up. If the note mentions sleep or stress, suggest looking at it; don\'t claim it is the cause.',
    lift_regressed: 'Hold the weight for now, check recovery (sleep, food, stress) and technique, and aim to get back to the earlier level before pushing on.',
    lift_stalled: `Double progression: keep the weight and add reps on every set until all sets reach the top of the rep range, then add the smallest jump (${unit === 'lb' ? '5 lb upper body, 10 lb lower body' : '2.5 kg upper body, 5 kg lower body'}).`,
    low_volume: 'Add 2-4 sets a week for that muscle, ideally in a session the user already does.',
    missed_sessions: 'Name the missed sessions and suggest a realistic way to fit the work in or plan around those days. Never scold; if the note explains it, acknowledge that.',
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

function schemaFor(findings: Finding[]) {
    const ids = findings.map((f) => f.id)
    const item = ids.length
        ? z.object({ findingId: z.enum(ids as [string, ...string[]]), action: z.string() })
        : z.object({ findingId: z.string(), action: z.string() })
    return z.object({
        headline: z.string().describe('One sentence: the most important thing about this period.'),
        items: z.array(item).max(ids.length ? MAX_ITEMS : 0).describe(ids.length ? `Advice for up to ${MAX_ITEMS} of the fired rules, most important first.` : 'No rules fired: leave this empty.'),
    })
}

/** Problems code can see in the output, beyond the schema. */
function problemsWith(n: ReportNarrative, findings: Finding[]): string | null {
    const ids = n.items.map((i) => i.findingId)
    if (new Set(ids).size !== ids.length) return 'the same rule was advised on twice'
    if (findings.length && !ids.length) return 'rules fired but no advice was given'
    if (findings.some((f) => f.rule === 'deload') && !ids.includes('deload:-')) return 'a deload fired but was left out'
    if (!n.headline.trim() || n.items.some((i) => !i.action.trim())) return 'empty text'
    return null
}

const nameOf = (l: { name: string; nameZh: string | null }, zh: boolean) => (zh && l.nameZh ? l.nameZh : l.name)
function liftLine(l: LiftFacts, zh: boolean, unit: string, setOf: (s: LiftFacts['best'], bodyweight: boolean) => string): string {
    const trend = l.trend === 'new' ? 'no earlier data'
        : l.trend === 'flat' ? `flat (${l.flatWindows} ${unit}s without a new best)`
        : `${l.trend} ${l.bodyweight ? `${l.change} reps` : `${l.change}%`}`
    return `- ${nameOf(l, zh)}: ${setOf(l.best, l.bodyweight)} (last ${unit} ${setOf(l.previousBest, l.bodyweight)}), ${trend}, ${l.sets} sets this ${unit}${l.goalLift ? ', named in the goal' : ''}`
}

export function buildPrompt(input: NarrativeInput): string {
    const { facts, findings, watching, followUps, note, language, weightUnit } = input
    const zh = language === 'zh-TW'
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const w = (kg: number) => `${toDisplayWeight(kg, weightUnit)} ${weightUnit}`
    const setOf = (s: LiftFacts['best'], bodyweight: boolean) => (!s ? '-' : bodyweight ? `${s.reps} reps (bodyweight)` : `${w(s.weightKg)} x ${s.reps}`)
    const ADVICE = advice(weightUnit)
    // Finding data keeps weights in kg ("82.5x8"); the model sees the user's unit. previousValue
    // is an internal estimated 1RM for the follow-up, not something to quote.
    const dataFor = (f: Finding) => Object.fromEntries(Object.entries(f.data).filter(([k]) => k !== 'previousValue').map(([k, v]) => {
        const m = typeof v === 'string' && /^(\d+(?:\.\d+)?)x(\d+)$/.exec(v)
        if (m) return [k, f.data.bodyweight ? `${m[2]} reps (bodyweight)` : `${w(Number(m[1]))} x ${m[2]}`]
        return [k.replace(/Kg$/, ''), (k === 'latestKg' || k === 'changeKg') && typeof v === 'number' ? w(v) : v]
    }))
    const s = facts.liftsSummary
    const lines = [
        `Period: ${facts.period.start} to ${facts.period.end} (one ${unit}, ${facts.period.days} days).`,
        `Status, decided by code: ${facts.status} (main lifts: ${s.up} up, ${s.flat} flat, ${s.down} down).`,
        `Sessions: ${facts.sessions.done}${facts.sessions.planned != null ? ` of ${facts.sessions.planned} planned` : ''}. Sets: ${facts.totalSets.now}${facts.totalSets.previous != null ? ` (last ${unit} ${facts.totalSets.previous})` : ''}.`,
        `Main lifts, best set this ${unit}:`,
        ...facts.lifts.map((l) => liftLine(l, zh, unit, setOf)),
        facts.records.length ? `New records (best estimated 1RM so far; not necessarily a new weight): ${facts.records.map((r) => `${nameOf(r, zh)} ${setOf(r.best, r.bodyweight)}`).join('; ')}.` : 'No new records.',
        `Sets per muscle per week (range 10-20 for chest, back, legs, shoulders, glutes): ${facts.muscles.map((m) => `${m.group} ${m.perWeek}`).join(', ')}.`,
        facts.bodyWeight.latestKg != null ? `Body weight: ${w(facts.bodyWeight.latestKg)}${facts.bodyWeight.changeKg != null ? ` (${facts.bodyWeight.changeKg >= 0 ? '+' : '-'}${w(Math.abs(facts.bodyWeight.changeKg))})` : ''}, ${facts.bodyWeight.weighIns} weigh-in(s) this ${unit}.` : 'No body weight logged.',
        `Weights are in ${weightUnit}; write every weight in ${weightUnit}.`,
        `The user's goal: ${facts.goal.text ? `"${facts.goal.text}"` : 'not set'}.`,
        `The user's note for this ${unit}: ${note ? `"${note}"` : 'none'}.`,
    ]
    if (followUps.length) {
        lines.push(`Last report's advice and how it went (the app shows this; mention it in the headline only if it matters):`,
            ...followUps.map((f) => `- ${f.id}: ${f.status}`))
    }
    lines.push(findings.length
        ? `Rules that fired. Advise only on these, by id:\n${findings.map((f) => `- id "${f.id}", priority ${f.priority}, data ${JSON.stringify(dataFor(f))}. Advice: ${ADVICE[f.rule]}`).join('\n')}`
        : 'No rules fired this period.')
    if (watching.length) lines.push(`Watching, below threshold (do not advise on these): ${watching.map((w) => `${w.rule}${w.subject ? ` ${w.subject}` : ''}`).join(', ')}.`)

    const languageRule = zh
        ? 'Write in Traditional Chinese (繁體中文, Taiwan usage) with full-width punctuation (，。！？「」), and use the Chinese exercise names given above.'
        : 'Write in English.'
    return `You write the short text of a strength-training app's weekly report. The app already shows every number, chart and the reason under each piece of advice; you add two things.

${lines.join('\n')}

1. headline: one sentence the user reads first, the most important thing about this ${unit}, consistent with the status. It may use a number from above. ${zh ? 'At most 40 characters.' : 'At most 25 words.'}
2. items: ${findings.length ? `advice for at most ${MAX_ITEMS} of the fired rules, most important first: usually by priority, but the goal or the note may change the order. A deload, if it fired, is always included and first. Each action is one or two short sentences saying exactly what to do next ${unit}, with the exercise, sets, weights or reps from the data. Don't repeat the reason; the app shows it.` : 'leave it empty: nothing fired, so give no advice.'}

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
            const problem = problemsWith(parsed.data, input.findings)
            if (!problem) return { narrative: parsed.data, prompt, model: response.model, usage, attempts: attempt }
            lastProblem = problem
        }
        console.warn(JSON.stringify({ event: 'claude_invalid_output', model: response.model, attempt, problem: lastProblem }))
    }
    throw new Error(`Claude returned an invalid report ${MAX_ATTEMPTS} times: ${lastProblem}`)
}
