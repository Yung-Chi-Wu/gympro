export interface ExerciseWithTranslation {
    id: string
    name: string
    name_zh_tw?: string | null
    muscle_group: string
    equipment?: string | null
}

export function getExerciseName(
    exercise: ExerciseWithTranslation,
    language: string
): string {
    if (language === 'zh-TW' && exercise.name_zh_tw) {
        return exercise.name_zh_tw
    }
    return exercise.name
}

export const MUSCLE_GROUP_LABELS: Record<string, Record<string, string>> = {
    en: {
        chest: 'Chest',
        back: 'Back',
        shoulders: 'Shoulders',
        biceps: 'Biceps',
        triceps: 'Triceps',
        legs: 'Legs',
        glutes: 'Glutes',
        core: 'Core',
        cardio: 'Cardio',
        other: 'Other',
    },
    'zh-TW': {
        chest: '胸',
        back: '背',
        shoulders: '肩',
        biceps: '二頭',
        triceps: '三頭',
        legs: '腿',
        glutes: '臀',
        core: '核心',
        cardio: '有氧',
        other: '其他',
    },
}

export function getMuscleGroupLabel(muscleGroup: string, language: string): string {
    return (
        MUSCLE_GROUP_LABELS[language]?.[muscleGroup] ??
        MUSCLE_GROUP_LABELS['en'][muscleGroup] ??
        muscleGroup
    )
}