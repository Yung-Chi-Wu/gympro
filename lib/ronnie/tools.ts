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
        description: "Add an exercise to today's workout. Today only and easy to undo, so do it right away when the user asks - no need to confirm or question the choice. Get the ID with search_exercises first.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID exactly as shown by search_exercises' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
    {
        name: 'remove_exercise_today',
        description: "Remove an exercise from today's workout only; the permanent routine is not affected. Today only, so do it right away when the user says they don't want to do it today - no need to confirm. The name is enough, no lookup first: it is matched against today's exercises, and if it matches none or several you get today's list with IDs to call again with exercise_id.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_name: { type: 'string', description: 'The exercise to remove, as the user named it' },
                exercise_id: { type: 'string', description: 'Optional: the ID from get_today_workout, if you already have it' },
            },
            required: ['exercise_name'],
        },
    },
    {
        name: 'recommend_exercise',
        description: "Show the user one recommended exercise as a card with an 'Add to today' button they can tap. Use it whenever you recommend a specific exercise, with an ID from search_exercises; call it once per exercise when the user asked for options. It changes nothing by itself. Not for explicit requests: when the user asks you to add a named exercise, add it with add_exercise_today.",
        input_schema: {
            type: 'object' as const,
            properties: {
                exercise_id: { type: 'string', description: 'Exercise ID exactly as shown by search_exercises' },
                exercise_name: { type: 'string', description: 'Exercise name shown on the card' },
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
        description: "Propose a permanent change to the user's routines: remove an exercise (from one routine, or from every routine when routine_name is omitted) or add one to a routine. Nothing changes until the user confirms it in the app, and the app tells the user what will change, so you don't need to describe it again. Call it once per exercise. Use this for every permanent routine change; never tell the user to edit routines themselves. Not for clearing routines or removing many exercises at once - that is a redesign (see the principles).",
        input_schema: {
            type: 'object' as const,
            properties: {
                change: { type: 'string', enum: ['remove', 'add'], description: 'remove (the default) or add' },
                exercise_id: { type: 'string', description: 'Exercise ID exactly as shown by search_exercises, get_routine_exercises or get_today_workout' },
                exercise_name: { type: 'string', description: 'Exercise name for confirmation' },
                routine_name: { type: 'string', description: 'remove: only this routine (omit for every routine). add: the routine to add it to (required).' },
                target_sets: { type: 'integer', description: 'add only: sets per session (default 3)' },
                target_reps: { type: 'integer', description: 'add only: reps per set (default 10)' },
            },
            required: ['exercise_id', 'exercise_name'],
        },
    },
]
