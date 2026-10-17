// A routine exercise's target, sets x reps: whole numbers in these ranges. The routine editor and
// Ronnie's proposals keep to them, and routine_exercises_targets_valid (migration 20261017130000)
// refuses anything else; Coach G's planner (lib/coach-g.ts SETS, REPS) stays inside them.
export const TARGET_SETS = { min: 1, max: 20 } as const
export const TARGET_REPS = { min: 1, max: 100 } as const

export const isTarget = (n: number, range: { min: number; max: number }) => Number.isInteger(n) && n >= range.min && n <= range.max
