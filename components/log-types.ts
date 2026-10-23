export interface ExerciseOption {
    id: string
    name: string
    name_zh_tw?: string | null
    muscle_group: string
    equipment: string | null
    /** Its place among the exercises the user did last, 0 the latest; missing when not one (lib/recent-exercises.ts) */
    recent?: number
    /** How its sets are logged (lib/set-log.ts); weight x reps when missing */
    log_type?: string | null
    /** Done one side at a time (lib/set-log.ts logNoteOf) */
    per_side?: boolean | null
}

export interface LoggedSet {
    id: string
    exerciseId: string
    exerciseName: string
    setNumber: number
    reps: number
    weightKg: number
}

export const MUSCLE_GROUPS = [
    'chest',
    'back',
    'shoulders',
    'biceps',
    'triceps',
    'legs',
    'glutes',
    'core',
    'cardio',
    'other',
] as const