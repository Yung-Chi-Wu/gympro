// The muscles the report counts weekly sets for. Shared by the report Lambda, which counts,
// and the report view, which labels and draws them.
//
// A category is split when its muscles are trained by different movements, so one kind of
// training can't make the whole category look done: presses train the front delts, raises
// the side delts, rows and reverse flys the rear delts; squats the quads, hinges and curls
// the hamstrings. Chest and back stay whole, because their muscles are trained together.
//
// A set counts 1 toward a unit its exercise mainly trains (a primary muscle) and 0.5 toward
// one it trains on the side (a secondary muscle): a bench press set is a chest set and
// half a triceps set.

export const VOLUME_UNITS = {
    chest: { muscles: ['chest', 'upper_chest', 'lower_chest'], target: true, zh: '胸', en: 'Chest' },
    back: { muscles: ['lats', 'upper_back', 'traps'], target: true, zh: '背', en: 'Back' },
    // Presses already give the front delts their work, so they get no range of their own
    front_delts: { muscles: ['front_delts'], target: false, zh: '肩前束', en: 'Front delts' },
    side_delts: { muscles: ['side_delts'], target: true, zh: '肩中束', en: 'Side delts' },
    rear_delts: { muscles: ['rear_delts'], target: true, zh: '肩後束', en: 'Rear delts' },
    quads: { muscles: ['quads'], target: true, zh: '股四頭', en: 'Quads' },
    hamstrings: { muscles: ['hamstrings'], target: true, zh: '腿後側', en: 'Hamstrings' },
    glutes: { muscles: ['glutes', 'abductors'], target: true, zh: '臀', en: 'Glutes' },
    biceps: { muscles: ['biceps'], target: true, zh: '二頭', en: 'Biceps' },
    triceps: { muscles: ['triceps'], target: true, zh: '三頭', en: 'Triceps' },
    calves: { muscles: ['calves'], target: false, zh: '小腿', en: 'Calves' },
    core: { muscles: ['abs', 'obliques'], target: false, zh: '核心', en: 'Core' },
} as const satisfies Record<string, { muscles: readonly string[]; target: boolean; zh: string; en: string }>

export type VolumeUnit = keyof typeof VOLUME_UNITS
export const VOLUME_UNIT_IDS = Object.keys(VOLUME_UNITS) as VolumeUnit[]
export const hasTarget = (unit: string) => !!VOLUME_UNITS[unit as VolumeUnit]?.target

// A custom exercise has only its category. One whose category is a single unit counts there;
// shoulders and legs are split, so a custom exercise there can't be placed and isn't counted.
const CATEGORY_UNIT: Record<string, VolumeUnit> = { chest: 'chest', back: 'back', biceps: 'biceps', triceps: 'triceps', glutes: 'glutes', core: 'core' }

/** What one set of an exercise counts toward each unit: 1 for a primary muscle, 0.5 for a secondary one. */
export function setWeights(primary: readonly string[], secondary: readonly string[], category: string): [VolumeUnit, number][] {
    if (!primary.length) return CATEGORY_UNIT[category] ? [[CATEGORY_UNIT[category], 1]] : []
    return VOLUME_UNIT_IDS.flatMap((unit): [VolumeUnit, number][] => {
        const muscles: readonly string[] = VOLUME_UNITS[unit].muscles
        if (primary.some((m) => muscles.includes(m))) return [[unit, 1]]
        if (secondary.some((m) => muscles.includes(m))) return [[unit, 0.5]]
        return []
    })
}

/**
 * Staple exercises to suggest when a unit is low, by library name, best first. Each mainly
 * trains its unit, is easy to learn, and loads the joints lightly where the unit allows
 * (the report Lambda suggests the first one the user doesn't already do).
 */
export const SUGGESTED_EXERCISES: Partial<Record<VolumeUnit, readonly string[]>> = {
    chest: ['Machine Chest Press', 'Pec Deck Fly', 'Dumbbell Bench Press'],
    back: ['Lat Pulldown', 'Seated Cable Row', 'Machine Row'],
    side_delts: ['Lateral Raise', 'Cable Lateral Raise', 'Machine Lateral Raise'],
    rear_delts: ['Rear Delt Machine', 'Face Pull', 'Cable Rear Delt Fly'],
    quads: ['Leg Press', 'Leg Extension', 'Goblet Squat'],
    hamstrings: ['Leg Curl', 'Romanian Deadlift'],
    glutes: ['Hip Thrust', 'Hip Thrust Machine', 'Glute Bridge'],
    biceps: ['Dumbbell Curl', 'Cable Curl', 'Machine Curl'],
    triceps: ['Triceps Pushdown', 'Rope Pushdown', 'Machine Triceps Extension'],
}
export const SUGGESTED_NAMES = [...new Set(Object.values(SUGGESTED_EXERCISES).flat())]

/** A unit's name; reports saved before the split use category names, which fall back to `category`. */
export function unitLabel(unit: string, language: string, category: (g: string) => string): string {
    const u = VOLUME_UNITS[unit as VolumeUnit]
    return u ? (language === 'zh-TW' ? u.zh : u.en) : category(unit)
}
