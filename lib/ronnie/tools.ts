import type Anthropic from '@anthropic-ai/sdk'

// Ronnie's tool definitions. Changes to the user's data come in two kinds:
// today's workout is edited directly, and permanent routine changes are only
// proposed - the user confirms them in the app (see propose_routine_change).
export const RONNIE_TOOLS: Anthropic.Tool[] = [

    {
        name: 'get_routine_exercises',
        description: 'Get the exercises in a specific routine by name, with their IDs. Use this when user asks what exercises are in a routine (not today\'s workout).',
        input_schema: {
            type: 'object' as const,
            properties: {
                routine_name: { type: 'string', description: 'The name of the routine to look up' },
            },
            required: ['routine_name'],
        },
    },

    {
        name: 'search_exercises',
        description: 'Search the exercise library. Use it before recommending a specific exercise, and recommend only exercises it returns, by their library name. Tolerates plurals, word order and partial names; when nothing matches exactly it returns the closest exercises and says so. If it finds nothing, try other wording (English or Chinese, a shorter keyword, or a muscle_group) before concluding the exercise is missing. It searches the library, not the user\'s routines.',
        input_schema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search term (exercise name)' },
                muscle_group: { type: 'string', description: 'Filter by muscle group: chest, back, shoulders, biceps, triceps, legs, glutes, core' },
            },
            required: [],
        },
    },
    {
        name: 'get_workout_history',
        description: "Get the user's workout history. Dates must be in user's local timezone YYYY-MM-DD.",
        input_schema: {
            type: 'object' as const,
            properties: {
                date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
                date_to: { type: 'string', description: 'End date YYYY-MM-DD' },
            },
            required: ['date_from', 'date_to'],
        },
    },
    {
        name: 'get_today_workout',
        description: "Get today's planned exercises (with their IDs) and logged sets. Shows routine plan if workout not started yet.",
        input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
    {
        name: 'add_exercise_today',
        description: "Add an exercise to today's workout. Must use search_exercises first to get the ID.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID from search_exercises' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
    {
        name: 'remove_exercise_today',
        description: "Remove an exercise from today's workout only. Does NOT affect the permanent routine.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID to remove' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
    {
        name: 'get_training_summary',
        description: "Totals computed by the app for a date range, per week (Monday to Sunday): sessions, working sets, volume (kg x reps), sets and sessions per muscle group, and the best set per exercise. Use it for any count, total, average or comparison - never add up workout history yourself. Dates are YYYY-MM-DD in the user's time zone.",
        input_schema: {
            type: 'object' as const,
            properties: {
                date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
                date_to: { type: 'string', description: 'End date YYYY-MM-DD' },
            },
            required: ['date_from', 'date_to'],
        },
    },
    {
        name: 'propose_routine_change',
        description: "Propose removing an exercise from the user's permanent routines - one routine (routine_name) or all of them. Nothing changes until the user taps Confirm in the app, so after calling this tell the user what will change and that they need to confirm. Use this for every permanent routine change; never tell the user to edit routines themselves.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID from search_exercises, get_routine_exercises or get_today_workout' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
                routine_name: { type: 'string', description: 'Only this routine; omit to remove it from every routine' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
]
