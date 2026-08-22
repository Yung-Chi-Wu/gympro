export type WeightUnit = 'kg' | 'lb'

export const KG_TO_LB = 2.20462
export const LB_TO_KG = 0.453592

export function toDisplayWeight(kg: number, unit: WeightUnit): number {
    if (unit === 'lb') {
        return Math.round(kg * KG_TO_LB * 10) / 10
    }
    return kg
}

export function toStorageKg(value: number, unit: WeightUnit): number {
    if (unit === 'lb') {
        return Math.round(value * LB_TO_KG * 100) / 100
    }
    return value
}

export function formatWeight(kg: number, unit: WeightUnit): string {
    const display = toDisplayWeight(kg, unit)
    return `${display}${unit}`
}