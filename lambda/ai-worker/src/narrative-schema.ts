import { z } from 'zod'

// The single source for the report format: the tool schema Claude is given is
// generated from this, and the same schema validates what Claude sends back.
export const AiNarrativeSchema = z.object({
    headline: z
        .string()
        .describe(
            'One short, plain-language sentence (max ~15 words) capturing the single most important takeaway. This is the only thing many users will read — no jargon, no numbers, just the headline.'
        ),
    summary: z.string().describe('A brief, encouraging overall assessment of the period.'),
    progressiveOverload: z.object({
        status: z.enum(['on_track', 'stalling', 'regressing', 'insufficient_data']),
        notes: z
            .string()
            .describe(
                'Explanation of whether specific lifts are progressing, referencing the strengthIndex data provided.'
            ),
    }),
    muscleImbalances: z
        .array(
            z.object({
                muscleGroup: z.string(),
                severity: z.enum(['mild', 'moderate', 'severe']),
                observation: z.string(),
            })
        )
        .describe('List any imbalances you observe. Return an empty array if none are significant.'),
    deloadRecommended: z.boolean(),
    deloadReason: z
        .string()
        .nullable()
        .describe('Required if deloadRecommended is true, otherwise null.'),
    actionItems: z.array(z.string()).describe('2-4 concrete, specific suggestions for the next period.'),
    contextSummary: z
        .string()
        .describe("One sentence summarizing this period's key takeaway, written for future reference next period."),
})

export type AiNarrative = z.infer<typeof AiNarrativeSchema>

// The tool API takes plain JSON Schema; the $schema dialect marker is not needed there
const { $schema: _dialect, ...narrativeJsonSchema } = z.toJSONSchema(AiNarrativeSchema)

export const RECOMMENDATION_INPUT_SCHEMA = narrativeJsonSchema as {
    type: 'object'
    [key: string]: unknown
}

/** One line per problem, e.g. "progressiveOverload: expected object, received string". */
export function describeIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
}
