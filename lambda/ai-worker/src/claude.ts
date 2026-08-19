import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './secrets'
import type { AiNarrative, TrainingPeriodSummary } from './types'

let cachedClient: Anthropic | null = null

async function getClaudeClient(): Promise<Anthropic> {
    if (cachedClient) {
        return cachedClient
    }

    const apiKey = await getSecret('gympro/anthropic-api-key')
    cachedClient = new Anthropic({ apiKey })
    return cachedClient
}

// This schema mirrors AiNarrative exactly — the quantitative fields
// (weeklyVolume, volumeSplit, strengthIndex) are deliberately NOT part of
// what Claude has to produce. Those are already computed from the
// database and get merged in afterward in index.ts, so Claude is never
// asked to recompute or restate numbers it was only given to read.
const RECOMMENDATION_TOOL = {
    name: 'submit_training_recommendation',
    description:
        'Submit a structured training recommendation based on the provided data.',
    input_schema: {
        type: 'object' as const,
        properties: {
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
                    'One sentence summarizing this period\'s key takeaway, written for future reference next period (e.g. "Advised deload due to back overtraining; confirm if followed.").',
            },
        },
        required: [
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
    userNote: string | null
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

    return `You are a knowledgeable, encouraging strength training coach analyzing a user's training data for one period (this may be a calendar week, or a custom training-cycle length the user has set up — treat the period given as the full unit of analysis regardless of its length).

${goalSection}${contextSection}${noteSection}Here is this period's objective training data (already calculated, do not recalculate any numbers):

${JSON.stringify(summary, null, 2)}

Analyze this data and submit a structured recommendation using the submit_training_recommendation tool. Base all quantitative judgments strictly on the numbers provided above — do not invent or assume any data not present here. Use the user's age, sex, and BMI, if provided in userContext, to calibrate what counts as reasonable training volume and intensity for their profile. Use strengthIndex (each muscle group's current index versus its own baseline, and previousIndex if available) as your primary evidence for progressive overload — an index that rose since previousIndex means real progress even without any weight increase, since it already accounts for rep changes too. Use volumeSplit and routineAdherence together to judge balance and consistency: a muscle group with low volumeSplit combined with missedRoutines naming that muscle group's routine is a stronger signal than either alone. Factor in the user's long-term goal and this period's note (if provided) when shaping your advice and action items — for example, if the user says they want to focus more on back, prioritize addressing that in actionItems even if the raw numbers alone wouldn't have flagged it. If totalSets is 0, note that no training was logged this period rather than speculating why.`
}

export async function generateRecommendation(
    summary: TrainingPeriodSummary,
    previousContext: string | null,
    trainingGoal: string | null,
    userNote: string | null
): Promise<AiNarrative> {
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

    const toolUseBlock = response.content.find((block) => block.type === 'tool_use')

    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
        throw new Error('Claude did not return a tool_use response')
    }

    return toolUseBlock.input as AiNarrative
}