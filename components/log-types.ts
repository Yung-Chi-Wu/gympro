export interface ExerciseOption {
    id: string
    name: string
    name_zh_tw?: string | null
    muscle_group: string
    equipment: string | null
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