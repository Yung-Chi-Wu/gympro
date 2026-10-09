// The fixed muscle vocabulary for exercises' primary and secondary muscles. Values come
// only from this list, so "front delts", "前束" and "前三角" can't become three
// different spellings that a filter would miss.

export const MUSCLES = {
    chest: { zh: '胸（整體）', en: 'Chest', group: 'chest' },
    upper_chest: { zh: '上胸', en: 'Upper chest', group: 'chest' },
    lower_chest: { zh: '下胸', en: 'Lower chest', group: 'chest' },
    front_delts: { zh: '肩膀前束', en: 'Front delts', group: 'shoulders' },
    side_delts: { zh: '肩膀中束', en: 'Side delts', group: 'shoulders' },
    rear_delts: { zh: '肩膀後束', en: 'Rear delts', group: 'shoulders' },
    lats: { zh: '背闊肌', en: 'Lats', group: 'back' },
    upper_back: { zh: '上背（菱形肌、中斜方）', en: 'Upper back', group: 'back' },
    traps: { zh: '上斜方', en: 'Traps', group: 'back' },
    // Erectors: back extensions and hinges train them, but they aren't the lats and
    // upper back that the back volume range is about
    lower_back: { zh: '下背（豎脊肌）', en: 'Lower back', group: null },
    biceps: { zh: '二頭', en: 'Biceps', group: 'biceps' },
    triceps: { zh: '三頭', en: 'Triceps', group: 'triceps' },
    forearms: { zh: '前臂（握力）', en: 'Forearms', group: null },
    quads: { zh: '股四頭', en: 'Quads', group: 'legs' },
    hamstrings: { zh: '腿後側', en: 'Hamstrings', group: 'legs' },
    adductors: { zh: '大腿內側', en: 'Adductors', group: 'legs' },
    calves: { zh: '小腿', en: 'Calves', group: 'legs' },
    glutes: { zh: '臀大肌', en: 'Glutes', group: 'glutes' },
    abductors: { zh: '臀外側（臀中肌）', en: 'Abductors', group: 'glutes' },
    abs: { zh: '腹直肌', en: 'Abs', group: 'core' },
    obliques: { zh: '腹斜肌', en: 'Obliques', group: 'core' },
    cardio: { zh: '心肺', en: 'Cardio', group: 'cardio' },
} as const

export type Muscle = keyof typeof MUSCLES
export const MUSCLE_IDS = Object.keys(MUSCLES) as Muscle[]

/** Joints an exercise loads, each rated low, medium or high */
export const JOINTS = ['shoulder', 'elbow', 'lower_back', 'knee'] as const
export type Joint = (typeof JOINTS)[number]
export const LEVELS = ['low', 'medium', 'high'] as const
export type Level = (typeof LEVELS)[number]

export const JOINT_LABELS: Record<Joint, { zh: string; en: string }> = {
    shoulder: { zh: '肩', en: 'Shoulder' },
    elbow: { zh: '手肘', en: 'Elbow' },
    lower_back: { zh: '下背', en: 'Lower back' },
    knee: { zh: '膝', en: 'Knee' },
}
