// The longest text a user can save in these fields. The database holds them to the same limits
// (migration 20261014140000): the profile goes into every Ronnie prompt and the report, and
// routine names into Ronnie's and the report's, so a pasted page would be paid for every time.
export const MAX_DISPLAY_NAME_CHARS = 50
export const MAX_TRAINING_GOAL_CHARS = 500
export const MAX_ROUTINE_NAME_CHARS = 60

// Text Postgres can't keep: jsonb and text refuse U+0000, and jsonb a lone UTF-16 surrogate. A
// message with one would go to the model and be billed, then fail to save with its trace, and
// the spend limits count cost from saved traces (lib/ai/spend-limits.ts).
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** Whether the database can keep this text as it is */
export const isStorableText = (s: string) => !UNSTORABLE.test(s)
