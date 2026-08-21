import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './secrets'
import type { AiNarrative, TrainingPeriodSummary } from './types'

let cachedClient: Anthropic | null = null

async function getClaudeClient(): Promise<Anthropic> {
    if (cachedClient) return cachedClient
    const apiKey = await getSecret('gympro/anthropic-api-key')
    cachedClient = new Anthropic({ apiKey })
    return cachedClient
}

const RECOMMENDATION_TOOL = {
    name: 'submit_training_recommendation',
    description: 'Submit a structured training recommendation based on the provided data.',
    input_schema: {
        type: 'object' as const,
        properties: {
            headline: {
                type: 'string',
                description:
                    'One short, plain-language sentence (max ~15 words) capturing the single most important takeaway. This is the only thing many users will read — no jargon, no numbers, just the headline.',
            },
            summary: {
                type: 'string',
                description: 'A brief, encouraging overall assessment of the period.',
            },
            progressiveOverload: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['on_track', 'stalling', 'regressing', 'insufficient_data'],
                    },
                    notes: {
                        type: 'string',
                        description:
                            'Explanation of whether specific lifts are progressing, referencing the strengthIndex data provided.',
                    },
                },
                required: ['status', 'notes'],
            },
            muscleImbalances: {
                type: 'array',
                description:
                    'List any imbalances you observe. Return an empty array if none are significant.',
                items: {
                    type: 'object',
                    properties: {
                        muscleGroup: { type: 'string' },
                        severity: { type: 'string', enum: ['mild', 'moderate', 'severe'] },
                        observation: { type: 'string' },
                    },
                    required: ['muscleGroup', 'severity', 'observation'],
                },
            },
            deloadRecommended: { type: 'boolean' },
            deloadReason: {
                type: ['string', 'null'],
                description: 'Required if deloadRecommended is true, otherwise null.',
            },
            actionItems: {
                type: 'array',
                items: { type: 'string' },
                description: '2-4 concrete, specific suggestions for the next period.',
            },
            contextSummary: {
                type: 'string',
                description:
                    "One sentence summarizing this period's key takeaway, written for future reference next period.",
            },
        },
        required: [
            'headline',
            'summary',
            'progressiveOverload',
            'muscleImbalances',
            'deloadRecommended',
            'deloadReason',
            'actionItems',
            'contextSummary',
        ],
    },
}

function buildPrompt(
    summary: TrainingPeriodSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null,
    language: string
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

    const languageInstruction =
        language === 'zh-TW'
            ? 'Respond entirely in Traditional Chinese (繁體中文). All text fields including headline, summary, notes, observations, and action items must be written in Traditional Chinese.'
            : 'Respond in English.'

    return `You are a knowledgeable, encouraging strength training coach analyzing a user's training data for one period (this may be a calendar week, or a custom training-cycle length the user has set up — treat the period given as the full unit of analysis regardless of its length).

${goalSection}${contextSection}${noteSection}Here is this period's objective training data (already calculated, do not recalculate any numbers):

${JSON.stringify(summary, null, 2)}

Analyze this data and submit a structured recommendation using the submit_training_recommendation tool. Base all quantitative judgments strictly on the numbers provided above — do not invent or assume any data not present here. Use the user's age, sex, and BMI, if provided in userContext, to calibrate what counts as reasonable training volume and intensity for their profile. Use strengthIndex as your primary evidence for progressive overload. Use volumeSplit and routineAdherence together to judge balance and consistency. Factor in the user's long-term goal and this period's note (if provided) when shaping your advice and action items. If totalSets is 0, note that no training was logged this period rather than speculating why.

${languageInstruction} Every text field you submit must be plain prose only — no XML tags, no markdown formatting, no stray closing tags of any kind. The headline must stand completely on its own — write it as if it's the only sentence the user will ever read.`
}

export async function generateRecommendation(
    summary: TrainingPeriodSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null,
    language: string
): Promise<AiNarrative> {
    const client = await getClaudeClient()

    const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        tools: [RECOMMENDATION_TOOL],
        tool_choice: { type: 'tool', name: 'submit_training_recommendation' },
        messages: [
            {
                role: 'user',
                content: buildPrompt(summary, previousContext, trainingGoal, userNote, language),
            },
        ],
    })

    const toolUseBlock = response.content.find((block) => block.type === 'tool_use')

    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        throw new Error('Claude did not return a tool_use response')
    }

    return toolUseBlock.input as AiNarrative
}