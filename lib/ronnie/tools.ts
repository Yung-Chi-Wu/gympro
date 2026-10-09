import type Anthropic from '@anthropic-ai/sdk'

// Ronnie's tools. Today's workout is changed directly; routines only through a
// proposal the user confirms in the app. When to use which is in the prompt's
// principles; descriptions here say what each tool does.

const exerciseId = (from: string) => ({ type: 'string', description: `Exercise ID as shown by ${from}` })
const dateRange = {
    date_from: { type: 'string', description: 'Start date, YYYY-MM-DD in the user\'s time zone' },
    date_to: { type: 'string', description: 'End date, YYYY-MM-DD in the user\'s time zone' },
}

export const RONNIE_TOOLS: Anthropic.Tool[] = [
    {
        name: 'get_routine_exercises',
        description: "A routine's exercises, with IDs and targets (a named routine, not today's workout).",
        input_schema: { type: 'object', properties: { routine_name: { type: 'string' } }, required: ['routine_name'] },
    },
    {
        name: 'search_exercises',
        description: "Search the exercise library (not the user's routines). Matches by meaning as well as by name, so a short description works (\"upper chest\", \"bodyweight legs\"), in English or Chinese, typos included, and it says when no name matched exactly. If the results don't fit, try other wording or muscle_group before saying it isn't there.",
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'An exercise name or a short description' },
                muscle_group: { type: 'string', description: 'chest, back, shoulders, biceps, triceps, legs, glutes or core' },
            },
            required: [],
        },
    },
    {
        name: 'get_workout_history',
        description: "The user's workouts in a date range: each day's exercises and sets.",
        input_schema: { type: 'object', properties: dateRange, required: ['date_from', 'date_to'] },
    },
    {
        name: 'get_today_workout',
        description: "Today's exercises with IDs and logged sets, or the routine's plan if today's workout hasn't started.",
        input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'add_exercise_today',
        description: "Add an exercise to today's workout only.",
        input_schema: { type: 'object', properties: { exercise_id: exerciseId('search_exercises') }, required: ['exercise_id'] },
    },
    {
        name: 'remove_exercise_today',
        description: "Remove an exercise from today's workout only; routines are unchanged. The name is enough: it is matched against today's exercises, and if that's ambiguous you get today's list with IDs.",
        input_schema: {
            type: 'object',
            properties: {
                exercise_name: { type: 'string', description: 'As the user named it' },
                exercise_id: { ...exerciseId('get_today_workout'), description: 'Optional: the ID from get_today_workout' },
            },
            required: ['exercise_name'],
        },
    },
    {
        name: 'recommend_exercise',
        description: "Show one recommended exercise as a card. With replaces_exercise_id the card's button swaps it for that exercise in today's workout; without, it adds it to today. It changes nothing until the user taps the button; for an explicit request to add an exercise, use add_exercise_today.",
        input_schema: {
            type: 'object',
            properties: {
                exercise_id: exerciseId('search_exercises'),
                replaces_exercise_id: { ...exerciseId('get_today_workout'), description: "Optional: the exercise in today's workout it would replace, ID from get_today_workout" },
            },
            required: ['exercise_id'],
        },
    },
    {
        name: 'get_training_summary',
        description: 'Totals computed by the app for a date range, per week (Monday to Sunday): sessions, sets, volume (kg x reps), sets and sessions per muscle group, and sets, sessions and the best set per exercise. This week and last week are named; this week is still under way and says which day it is.',
        input_schema: { type: 'object', properties: dateRange, required: ['date_from', 'date_to'] },
    },
    {
        name: 'propose_routine_change',
        description: "Propose a permanent routine change: remove an exercise (from one routine, or every routine that has it if routine_name is omitted) or add one to a routine. Nothing changes until the user confirms it in the app, which also shows them what will change. One call per exercise.",
        input_schema: {
            type: 'object',
            properties: {
                change: { type: 'string', enum: ['remove', 'add'], description: 'remove (the default) or add' },
                exercise_id: exerciseId('search_exercises, get_routine_exercises or get_today_workout'),
                routine_name: { type: 'string', description: 'remove: only this routine (omit for all). add: the routine (required).' },
                target_sets: { type: 'integer', description: 'add only, default 3' },
                target_reps: { type: 'integer', description: 'add only, default 10' },
            },
            required: ['exercise_id'],
        },
    },
]
