import type Anthropic from '@anthropic-ai/sdk'

// Ronnie's tool definitions, moved verbatim from app/api/ai/coach/route.ts
export const RONNIE_TOOLS: Anthropic.Tool[] = [

    {
        name: 'get_routine_exercises',
        description: 'Get the exercises in a specific routine by name. Use this when user asks what exercises are in a routine (not today\'s workout).',
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
        description: 'Search the exercise database. MUST use this before recommending any exercise.',
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
        description: "Get today's planned exercises and logged sets. Shows routine plan if workout not started yet.",
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
]
