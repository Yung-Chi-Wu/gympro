// The fixed vocabularies for an exercise's attributes: its primary and secondary muscles,
// the load it puts on joints, and how its sets are logged. Values come only from these
// lists, so "front delts", "前束" and "前三角" can't become three different spellings
// that a filter would miss.

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

/** How a set of the exercise is logged, shown and summarised */
export const LOG_TYPES = {
    weight_reps: { zh: '重量 × 次數', en: 'Weight × reps' },
    // Added weight; 0 is bodyweight alone
    bodyweight: { zh: '自重（可加重）', en: 'Bodyweight (+ added weight)' },
    // The machine's help; less is stronger
    assisted: { zh: '輔助', en: 'Assisted' },
    duration: { zh: '時間（秒）', en: 'Duration (s)' },
    treadmill: { zh: '跑步機：分鐘、速度、坡度', en: 'Treadmill: min, speed, incline' },
    cardio_level: { zh: '分鐘、段數', en: 'Min, level' },
    rower: { zh: '分鐘、公尺', en: 'Min, metres' },
    cardio_time: { zh: '只有分鐘', en: 'Min only' },
} as const
export type LogType = keyof typeof LOG_TYPES
export const LOG_TYPE_IDS = Object.keys(LOG_TYPES) as LogType[]
export const CARDIO_LOG_TYPES: LogType[] = ['treadmill', 'cardio_level', 'rower', 'cardio_time']
