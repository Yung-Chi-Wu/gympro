// Distances and speeds are stored metric (km/h, metres); km/mi only changes what the user
// sees and types, like kg/lb in weight-unit.ts. A rower's metres stay metres in both:
// that's what the machine shows.

export type DistanceUnit = 'km' | 'mi'

export const KM_PER_MI = 1.609344

/** A speed for display: km/h, or mph */
export function toDisplaySpeed(kmh: number, unit: DistanceUnit): number {
    return Math.round((unit === 'mi' ? kmh / KM_PER_MI : kmh) * 10) / 10
}

/** A speed typed in the user's unit, as km/h for storage */
export function toStorageKmh(value: number, unit: DistanceUnit): number {
    return unit === 'mi' ? Math.round(value * KM_PER_MI * 100) / 100 : value
}

/** A distance in km for display: km, or miles */
export function toDisplayDistance(km: number, unit: DistanceUnit): number {
    return Math.round((unit === 'mi' ? km / KM_PER_MI : km) * 100) / 100
}
