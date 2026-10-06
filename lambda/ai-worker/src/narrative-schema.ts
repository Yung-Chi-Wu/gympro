import { z } from 'zod'

export const PROGRESS_STATUSES = ['on_track', 'stalling', 'regressing', 'insufficient_data'] as const
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number]

// The single source for what Claude writes: the tool schema Claude is given is
// generated from this, and the same schema validates what Claude sends back.
// The progress status is not in it - code computes that (progress-status.ts)
// and Claude only explains it.
export const ClaudeNarrativeSchema = z.object({
    headline: z
        .string()
        .describe(
            'One short, plain-language sentence (max ~15 words) capturing the single most important takeaway. This is the only thing many users will read — no jargon, no numbers, just the headline.'
        ),
    summary: z.string().describe('A brief, encouraging overall assessment of the period.'),
    progressiveOverload: z.object({
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

type ClaudeNarrative = z.infer<typeof ClaudeNarrativeSchema>

// The saved report: Claude's text plus the status computed in code
export type AiNarrative = Omit<ClaudeNarrative, 'progressiveOverload'> & {
    progressiveOverload: ClaudeNarrative['progressiveOverload'] & { status: ProgressStatus }
}

// The tool API takes plain JSON Schema; the $schema dialect marker is not needed there
const { $schema: _dialect, ...narrativeJsonSchema } = z.toJSONSchema(ClaudeNarrativeSchema)

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
