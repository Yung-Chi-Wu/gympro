import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './secrets'
import type { AiRecommendation, WeeklyTrainingSummary } from './types'

let cachedClient: Anthropic | null = null

async function getClaudeClient(): Promise<Anthropic> {
    if (cachedClient) {
        return cachedClient
    }

    const apiKey = await getSecret('gympro/anthropic-api-key')
    cachedClient = new Anthropic({ apiKey })
    return cachedClient
}

// This schema is the "form" Claude must fill out. It mirrors the
// AiRecommendation type in types.ts exactly — if you change one,
// change the other to match.
const RECOMMENDATION_TOOL = {
    name: 'submit_training_recommendation',
    description:
        'Submit a structured weekly training recommendation based on the provided data.',
    input_schema: {
        type: 'object' as const,
        properties: {
            summary: {
                type: 'string',
                description: 'A brief, encouraging overall assessment of the week.',
            },
            weeklyVolume: {
                type: 'object',
                properties: {
                    totalSets: { type: 'integer' },
                    totalTonnageKg: { type: 'number' },
                    byMuscleGroup: {
                        type: 'object',
                        description:
                            'Keys are muscle group names, values are { sets, tonnageKg }.',
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                sets: { type: 'integer' },
                                tonnageKg: { type: 'number' },
                            },
                            required: ['sets', 'tonnageKg'],
                        },
                    },
                },
                required: ['totalSets', 'totalTonnageKg', 'byMuscleGroup'],
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
                            'Explanation of whether specific lifts are progressing, referencing the tonnage trend data provided.',
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
                description: '2-4 concrete, specific suggestions for next week.',
            },
            contextSummary: {
                type: 'string',
                description:
                    'One sentence summarizing this week\'s key takeaway, written for future reference next week (e.g. "Advised deload due to back overtraining; confirm if followed.").',
            },
        },
        required: [
            'summary',
            'weeklyVolume',
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
    summary: WeeklyTrainingSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null
): string {
    const contextSection = previousContext
        ? `Context from last week's recommendation: ${previousContext}\n\n`
        : `This is the user's first week receiving a recommendation, so there is no prior context.\n\n`

    const goalSection = trainingGoal
        ? `The user's long-term training goal: "${trainingGoal}"\n\n`
        : `The user has not set a specific long-term training goal.\n\n`

    const noteSection = userNote
        ? `The user's note for this specific week: "${userNote}"\n\n`
        : ``

    return `You are a knowledgeable, encouraging strength training coach analyzing a user's weekly training data.

${goalSection}${contextSection}${noteSection}Here is this week's objective training data (already calculated, do not recalculate any numbers):

${JSON.stringify(summary, null, 2)}

Analyze this data and submit a structured recommendation using the submit_training_recommendation tool. Base all quantitative judgments strictly on the numbers provided above — do not invent or assume any data not present here. Use the user's age, sex, and BMI, if provided in userContext, to calibrate what counts as reasonable training volume and intensity for their profile. Factor in the user's long-term goal and this week's note (if provided) when shaping your advice and action items — for example, if the user says they want to focus more on back, prioritize addressing that in actionItems even if the raw numbers alone wouldn't have flagged it. If totalSets is 0, note that no training was logged this week rather than speculating why.`
}


export async function generateRecommendation(
    summary: WeeklyTrainingSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null
): Promise<AiRecommendation> {
    const client = await getClaudeClient()

    const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        tools: [RECOMMENDATION_TOOL],
        tool_choice: { type: 'tool', name: 'submit_training_recommendation' },
        messages: [
            {
                role: 'user',
                content: buildPrompt(summary, previousContext, trainingGoal, userNote),
            },
        ],
    })

    const toolUseBlock = response.content.find(
        (block) => block.type === 'tool_use'
    )

    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        throw new Error('Claude did not return a tool_use response')
    }

    return toolUseBlock.input as AiRecommendation
}