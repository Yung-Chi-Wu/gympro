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
/** The picker's sections after the recent one, in this order; any other equipment is under other */
export const EQUIPMENT_SECTIONS = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'] as const

/** At most this many exercises done lately head a group */
export const RECENT_SHOWN = 5

const SECTION_LABELS: Record<string, Record<string, string>> = {
    en: { recent: 'Done lately', barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', bodyweight: 'Bodyweight', other: 'Other' },
    'zh-TW': { recent: '最近做過', barbell: '槓鈴', dumbbell: '啞鈴', machine: '器械', cable: '繩索', bodyweight: '徒手', other: '其他' },
}

export interface ExerciseSection<T> {
    key: string
    label: string
    exercises: T[]
}

/**
 * One muscle group's exercises as the picker lists them (2026-10-23), so a longer library stays easy
 * to look through: up to RECENT_SHOWN done lately first, the latest on top, then one section per kind
 * of equipment, each by name in the user's language. Each exercise is listed once; empty sections
 * are left out. `recent` is the exercise's place among those done lately (lib/recent-exercises.ts).
 */
export function exerciseSections<T extends ExerciseWithTranslation & { recent?: number }>(exercises: T[], language: string): ExerciseSection<T>[] {
    const labels = SECTION_LABELS[language] ?? SECTION_LABELS.en
    const collator = new Intl.Collator(language === 'zh-TW' ? 'zh-Hant-TW' : 'en')
    const byName = (a: T, b: T) => collator.compare(getExerciseName(a, language), getExerciseName(b, language))
    const recent = exercises
        .filter((ex) => ex.recent != null)
        .sort((a, b) => a.recent! - b.recent!)
        .slice(0, RECENT_SHOWN)
    const rest = exercises.filter((ex) => !recent.includes(ex))
    const sectionOf = (ex: T): string => (EQUIPMENT_SECTIONS as readonly string[]).includes(ex.equipment ?? '') ? ex.equipment! : 'other'
    return [
        { key: 'recent', label: labels.recent, exercises: recent },
        ...EQUIPMENT_SECTIONS.map((key) => ({ key, label: labels[key], exercises: rest.filter((ex) => sectionOf(ex) === key).sort(byName) })),
    ].filter((section) => section.exercises.length)
}
