import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './secrets'
import { ClaudeNarrativeSchema, describeIssues, RECOMMENDATION_INPUT_SCHEMA, type ProgressStatus } from './narrative-schema'
import { computeProgressStatus, MEANINGFUL_CHANGE } from './progress-status'
import type { AiNarrative, TrainingPeriodSummary } from './types'

let cachedClient: Anthropic | null = null

// Exported for the eval runner, which reuses the same key for its judge calls
export async function getClaudeClient(): Promise<Anthropic> {
    if (cachedClient) return cachedClient
    const parameterName = process.env.ANTHROPIC_API_KEY_PARAM
    if (!parameterName) {
        throw new Error('ANTHROPIC_API_KEY_PARAM environment variable is not set')
    }
    const apiKey = await getSecret(parameterName)
    cachedClient = new Anthropic({ apiKey })
    return cachedClient
}

const RECOMMENDATION_TOOL = {
    name: 'submit_training_recommendation',
    description: 'Submit a structured training recommendation based on the provided data.',
    input_schema: RECOMMENDATION_INPUT_SCHEMA,
}

// Models that support strict tool use, which guarantees the tool input matches
// the schema. Sonnet 4.6 does not; Haiku 4.5 broke the schema in 46 of 66 eval
// runs without it.
const STRICT_TOOL_MODELS = ['claude-haiku-4-5']

function recommendationTool(model: string) {
    const strict = STRICT_TOOL_MODELS.some((prefix) => model.startsWith(prefix))
    return strict ? { ...RECOMMENDATION_TOOL, strict: true } : RECOMMENDATION_TOOL
}

function buildPrompt(
    summary: TrainingPeriodSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null,
    language: string,
    status: ProgressStatus
): string {
    const contextSection = previousContext
        ? `Context from the last period's recommendation: ${previousContext}\n\n`
        : `This is the user's first period receiving a recommendation, so there is no prior context.\n\n`

    const goalSection = trainingGoal
        ? `The user's long-term training goal: "${trainingGoal}"\n\n`
        : `The user has not set a specific long-term training goal.\n\n`

    const noteSection = userNote
        ? `The user's note for this specific period: "${userNote}"\n\n`
        : ``

    const statusSection = `Progress status for this period: ${status}. This was computed from strengthIndex by a fixed rule, so treat it as settled and use progressiveOverload.notes to explain it with the specific numbers. The rule: regressing if any muscle group's index dropped ${MEANINGFUL_CHANGE}+ points, otherwise on_track if any rose ${MEANINGFUL_CHANGE}+ points, otherwise stalling; changes are measured against previousIndex, or against 100 (the user's first recorded level) when previousIndex is null.\n\n`

    const languageInstruction =
        language === 'zh-TW'
            ? 'Respond entirely in Traditional Chinese (繁體中文). All text fields including headline, summary, notes, observations, and action items must be written in Traditional Chinese.'
            : 'Respond in English.'

    return `You are a knowledgeable, encouraging strength training coach analyzing a user's training data for one period (this may be a calendar week, or a custom training-cycle length the user has set up — treat the period given as the full unit of analysis regardless of its length).

${goalSection}${contextSection}${noteSection}Here is this period's objective training data (already calculated, do not recalculate any numbers):

${JSON.stringify(summary, null, 2)}

${statusSection}Analyze this data and submit a structured recommendation using the submit_training_recommendation tool. Base all quantitative judgments strictly on the numbers provided above — do not invent or assume any data not present here. Use the user's age, sex, and BMI, if provided in userContext, to calibrate what counts as reasonable training volume and intensity for their profile. Use strengthIndex as your primary evidence for progressive overload. Use volumeSplit and routineAdherence together to judge balance and consistency. Factor in the user's long-term goal and this period's note (if provided) when shaping your advice and action items. If totalSets is 0, note that no training was logged this period rather than speculating why.

${languageInstruction} Every text field you submit must be plain prose only — no XML tags, no markdown formatting, no stray closing tags of any kind. The headline must stand completely on its own — write it as if it's the only sentence the user will ever read.`
}

export const DEFAULT_MODEL = 'claude-sonnet-4-6'

// A malformed report gets one fresh attempt in the same invocation. Two Sonnet
// calls (~35s each) fit inside the 120s Lambda timeout; if both fail, the error
// goes to SQS, which retries later and finally lands in the DLQ alarm.
const MAX_ATTEMPTS = 2

export interface RecommendationResult {
    narrative: AiNarrative
    // The rest is for the eval runner: the exact prompt sent, plus what it cost
    prompt: string
    model: string
    stopReason: string | null
    // Summed over every attempt, so a retried report is billed in full
    usage: Anthropic.Usage
    attempts: number
}

export async function generateRecommendation(
    summary: TrainingPeriodSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null,
    language: string,
    model: string = DEFAULT_MODEL
): Promise<RecommendationResult> {
    const client = await getClaudeClient()
    const status = computeProgressStatus(summary.strengthIndex)
    const prompt = buildPrompt(summary, previousContext, trainingGoal, userNote, language, status)

    let inputTokens = 0
    let outputTokens = 0
    let lastProblem = ''

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const startedAt = Date.now()
        const response = await client.messages.create({
            model,
            // A full zh-TW report runs ~1,500 characters; 2048 left too little headroom
            max_tokens: 4096,
            tools: [recommendationTool(model)],
            tool_choice: { type: 'tool', name: 'submit_training_recommendation' },
            messages: [{ role: 'user', content: prompt }],
        })
        inputTokens += response.usage.input_tokens
        outputTokens += response.usage.output_tokens

        // One JSON line per call so cost and latency can be queried in CloudWatch Logs Insights
        console.log(
            JSON.stringify({
                event: 'claude_call',
                model: response.model,
                attempt,
                stopReason: response.stop_reason,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                durationMs: Date.now() - startedAt,
            })
        )

        // A truncated tool call would save an incomplete report — fail loudly instead
        if (response.stop_reason === 'max_tokens') {
            throw new Error(`Claude response hit max_tokens (${response.usage.output_tokens} output tokens)`)
        }

        const toolUseBlock = response.content.find((block) => block.type === 'tool_use')
        if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
            lastProblem = 'no tool_use block in the response'
        } else {
            const parsed = ClaudeNarrativeSchema.safeParse(toolUseBlock.input)
            if (parsed.success) {
                return {
                    narrative: {
                        ...parsed.data,
                        progressiveOverload: { ...parsed.data.progressiveOverload, status },
                    },
                    prompt,
                    model: response.model,
                    stopReason: response.stop_reason,
                    usage: { ...response.usage, input_tokens: inputTokens, output_tokens: outputTokens },
                    attempts: attempt,
                }
            }
            lastProblem = describeIssues(parsed.error)
        }

        console.warn(JSON.stringify({ event: 'claude_invalid_output', model: response.model, attempt, problem: lastProblem }))
    }

    throw new Error(`Claude returned an invalid report ${MAX_ATTEMPTS} times: ${lastProblem}`)
}
