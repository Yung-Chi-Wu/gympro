// The user's time zone (user_profiles.timezone), which decides which day a set, a weigh-in or
// a note belongs to, and when each period ends. Shared by the app, Ronnie and the report worker,
// so they all fall back the same way.

/**
 * The column's default: what a profile has until a zone is set. Onboarding never set one, so a
 * profile still on it is taken to mean "not chosen" and gets the browser's zone (TimeZoneSync).
 * Choosing UTC in Settings stores CHOSEN_UTC, the same zone under its other name, so it stays.
 */
export const UNSET_TIME_ZONE = 'UTC'
export const CHOSEN_UTC = 'Etc/UTC'

export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone })
        return true
    } catch {
        return false
    }
}

/** The zone days are counted in: the profile's, or UTC when it has none or one Intl doesn't know */
export const timeZoneOf = (timeZone: string | null | undefined): string =>
    timeZone && isValidTimeZone(timeZone) ? timeZone : UNSET_TIME_ZONE

/** The browser's zone when it is worth adopting: a real place, not UTC itself */
export function browserTimeZone(): string | null {
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        return zone && zone !== UNSET_TIME_ZONE && zone !== CHOSEN_UTC && isValidTimeZone(zone) ? zone : null
    } catch {
        return null
    }
}

/** Minutes the zone is ahead of UTC at this instant */
function offsetMinutes(instant: number, timeZone: string): number {
    const p: Record<string, string> = {}
    for (const { type, value } of new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant)) p[type] = value
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
    return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000)
}

const localDateAt = (instant: number, timeZone: string) => new Date(instant).toLocaleDateString('en-CA', { timeZone })

/** The instant a local date starts in the zone: its midnight, at the offset in force then */
function startOfLocalDay(date: string, timeZone: string): number {
    const midnight = Date.parse(`${date}T00:00:00Z`)
    // The offset at a guess, then at the instant it gives: the two differ only when a clock
    // change falls between them, and the second is the one in force at midnight
    const first = midnight - offsetMinutes(midnight, timeZone) * 60_000
    const second = midnight - offsetMinutes(first, timeZone) * 60_000
    // Where the clock jumps over midnight (Chile in September) there is none: the day starts at
    // the jump, which the first guess lands on, while the second falls back into the day before
    return localDateAt(second, timeZone) === date ? second : first
}

/**
 * A local date's first and last instant, as UTC ISO strings. Measured at each midnight, so the
 * day a clock changes is 23 or 25 hours long instead of shifted by one (the offset at noon was
 * used for the whole day before).
 */
export function localDayToUtcRange(date: string, timeZone: string): { start: string; end: string } {
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    return {
        start: new Date(startOfLocalDay(date, timeZone)).toISOString(),
        end: new Date(startOfLocalDay(next, timeZone) - 1).toISOString(),
    }
}
