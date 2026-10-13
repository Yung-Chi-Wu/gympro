// Free check of the day boundaries every reader of a local date uses (lib/time-zone.ts): each
// day of a year, in zones with every kind of clock change, starts and ends exactly on its local
// date, and a profile's zone falls back the same way everywhere.
//   npm run check:time-zone
import { localDayToUtcRange, timeZoneOf } from '../lib/time-zone'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const localDate = (instant: number, timeZone: string) => new Date(instant).toLocaleDateString('en-CA', { timeZone })

// Taipei and India (no clock changes, a half-hour offset), New York, Los Angeles and London (a
// change at 2 am or 1 am), Lord Howe (a half-hour change), Santiago, Havana and Beirut (a change
// at midnight, so one midnight doesn't exist), and UTC
const ZONES = ['Asia/Taipei', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Lord_Howe', 'America/Santiago', 'America/Havana', 'Asia/Beirut', 'UTC']
for (const zone of ZONES) {
    const wrong: string[] = []
    for (let d = Date.parse('2026-01-01T00:00:00Z'); d < Date.parse('2027-01-01T00:00:00Z'); d += 86_400_000) {
        const date = new Date(d).toISOString().slice(0, 10)
        const { start, end } = localDayToUtcRange(date, zone)
        const s = Date.parse(start)
        const e = Date.parse(end)
        // The first and last instant of that local date: one millisecond either side is another day
        if (localDate(s, zone) !== date || localDate(s - 1, zone) === date || localDate(e, zone) !== date || localDate(e + 1, zone) === date) wrong.push(`${date}: ${start} to ${end}`)
    }
    check(`${zone}: every day of 2026 is exactly its local date`, !wrong.length, wrong.slice(0, 3).join('; '))
}

const hours = (date: string, zone: string) => {
    const { start, end } = localDayToUtcRange(date, zone)
    return (Date.parse(end) + 1 - Date.parse(start)) / 3_600_000
}
check('New York gains an hour on 2026-11-01 (the noon offset shifted it instead)', hours('2026-11-01', 'America/New_York') === 25)
check('New York loses an hour on 2026-03-08', hours('2026-03-08', 'America/New_York') === 23)
check('a profile without a zone, or with one Intl does not know, counts days in UTC', timeZoneOf(null) === 'UTC' && timeZoneOf('') === 'UTC' && timeZoneOf('Mars/Olympus') === 'UTC')
check('a profile\'s own zone is kept, Etc/UTC included', timeZoneOf('Asia/Taipei') === 'Asia/Taipei' && timeZoneOf('Etc/UTC') === 'Etc/UTC')

console.log(failed ? `\n${failed} check(s) failed` : '\nDay boundaries are exact in every zone')
process.exit(failed ? 1 : 0)
