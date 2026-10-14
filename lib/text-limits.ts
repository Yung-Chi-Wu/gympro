// The longest text a user can save in these fields. The database holds them to the same limits
// (migration 20261014140000): the profile goes into every Ronnie prompt and the report, and
// routine names into Ronnie's and the report's, so a pasted page would be paid for every time.
export const MAX_DISPLAY_NAME_CHARS = 50
export const MAX_TRAINING_GOAL_CHARS = 500
export const MAX_ROUTINE_NAME_CHARS = 60
