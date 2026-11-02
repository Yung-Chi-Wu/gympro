// Free check of 成就 (lib/awards.ts): each award's best and the day each mark was first reached,
// worked out from awards_page's answer in the user's zone and unit. New bests by the report's own
// rule (lib/report/records.ts), one a day per exercise. That the report uses the same rule, the
// award exercises are the library's, and the migration reads the strength log types the rule
// knows.
//   npm run check:awards
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AWARD_EXERCISES, awardTracks, LIFT_TIERS, type AwardId, type AwardsPage, type AwardTrack } from '../lib/awards'
import { STRENGTH_LOG_TYPES } from '../lib/report/progression'
import { toStorageKg } from '../lib/weight-unit'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const SQUAT = AWARD_EXERCISES.squat[0]
const PULL_UP = AWARD_EXERCISES.pullup[0]
const CHIN_UP = AWARD_EXERCISES.pullup[1]
const exercises: AwardsPage['exercises'] = [
    { id: SQUAT, log_type: 'weight_reps', muscle_group: 'legs' },
    { id: PULL_UP, log_type: 'bodyweight', muscle_group: 'back' },
    { id: CHIN_UP, log_type: 'bodyweight', muscle_group: 'back' },
    { id: 'curl', log_type: 'weight_reps', muscle_group: 'arms' },
    { id: 'apu', log_type: 'assisted', muscle_group: 'back' },
    { id: 'crunch', log_type: 'weight_reps', muscle_group: 'core' },
    { id: 'tread', log_type: 'treadmill', muscle_group: 'cardio' },
]
/** A set at noon UTC on `date` */
const set = (exerciseId: string, date: string, kg: number, reps: number, assist: number | null = null): AwardsPage['sets'][number] =>
    [exerciseId, `${date}T12:00:00+00:00`, kg, reps, assist]
const page = (sets: AwardsPage['sets'], weeks: AwardsPage['weeks'] = []): AwardsPage => ({ sets, exercises, weeks })
const track = (tracks: AwardTrack[], id: AwardId) => tracks.find((t) => t.id === id)!
const kg = { timeZone: 'UTC', weightUnit: 'kg' } as const

// A lift: the heaviest set with a rep, and the first day each mark was reached
{
    const tracks = awardTracks(page([
        set(SQUAT, '2026-09-01', 60, 5),
        set(SQUAT, '2026-09-08', 95, 3),
        set(SQUAT, '2026-09-15', 100, 1),
        set(SQUAT, '2026-09-22', 90, 8),
        set(SQUAT, '2026-09-29', 150, 0),
    ]), kg)
    const squat = track(tracks, 'squat')
    check('a lift reads its heaviest set with a rep: a 0-rep set is not a lift', squat.best === 100, JSON.stringify(squat))
    check('each mark is dated the day it was first reached, and a lighter set later changes nothing',
        same(squat.reached, ['2026-09-01', '2026-09-15', null]), JSON.stringify(squat.reached))
    check('a user who never logged a lift has none of its marks', same(track(tracks, 'bench'), { id: 'bench', tiers: LIFT_TIERS.bench.kg, best: 0, reached: [null, null, null] }))
}

// lb: the marks are the user's, and a set typed as 225 lb reaches 225 lb after it is stored in kg
{
    const squat = track(awardTracks(page([set(SQUAT, '2026-09-01', toStorageKg(225, 'lb'), 1)]), { timeZone: 'UTC', weightUnit: 'lb' }), 'squat')
    check('225 lb logged reaches the 225 lb mark', squat.best === 225 && same(squat.reached, ['2026-09-01', '2026-09-01', null]), JSON.stringify(squat))
}

// The day is the user's: a workout at 03:00 UTC is the evening before in New York
{
    const squat = track(awardTracks(page([[SQUAT, '2026-10-01T03:00:00+00:00', 60, 1, null]]), { timeZone: 'America/New_York', weightUnit: 'kg' }), 'squat')
    check('a mark is dated in the user\'s zone', squat.reached[0] === '2026-09-30', JSON.stringify(squat.reached))
}

// Pull-ups: the most reps in one set, over every grip; an assisted pull-up is another exercise
{
    const pullup = track(awardTracks(page([
        set(PULL_UP, '2026-09-01', 0, 3),
        set(CHIN_UP, '2026-09-03', 0, 6),
        set(PULL_UP, '2026-09-05', 10, 4),
        set('apu', '2026-09-06', 0, 12, 30),
    ]), kg), 'pullup')
    check('pull-ups count the most reps in a set over every grip, weighted sets too, and never the assisted one',
        pullup.best === 6 && same(pullup.reached, ['2026-09-01', '2026-09-03', null]), JSON.stringify(pullup))
}

// Weeks on plan: a weekly report whose cycle planned sessions and all were done, counted in all
{
    const week = (end: string, planned: number, done: number, days = 7) => ({ end, days, planned, done })
    const weeks = track(awardTracks(page([], [
        week('2026-09-06', 3, 3), week('2026-09-13', 3, 2), week('2026-09-20', 3, 4), week('2026-09-27', 0, 0),
        week('2026-10-04', 4, 4, 14), week('2026-10-11', 3, 3), week('2026-10-18', 3, 3),
    ]), kg), 'weeks')
    check('a week counts when every planned session was done, not in a row; a week planning none and a longer period never count',
        weeks.best === 4 && weeks.reached[0] === '2026-10-18', JSON.stringify(weeks))
}

// New bests: by the report's rule, one a day per exercise
{
    const records = track(awardTracks(page([
        set('curl', '2026-09-01', 10, 10),          // first day: nothing to beat
        set('curl', '2026-09-03', 10, 12),          // more reps: a best
        set('curl', '2026-09-03', 12, 10),          // and another the same day: still one
        set('curl', '2026-09-05', 10, 8),           // below: not one
        set('curl', '2026-09-07', 12.5, 10),        // a best
        set('apu', '2026-09-01', 0, 8, 30),
        set('apu', '2026-09-08', 0, 8, 25),         // less assist: a best
        set('apu', '2026-09-10', 0, 8, 35),         // more assist: not one
        set(PULL_UP, '2026-09-02', 0, 5),
        set(PULL_UP, '2026-09-09', 0, 7),           // a bodyweight lift by reps: a best
        set('crunch', '2026-09-01', 10, 10),
        set('crunch', '2026-09-08', 20, 10),        // core work is not a lift: not one
    ]), kg), 'records')
    check('new bests: the day\'s best beats every earlier set, once a day per exercise, by less assist or more reps where those order it, never core work',
        records.best === 4 && records.reached[0] === '2026-09-03', JSON.stringify(records))
}

// One rule: the report counts records with the same function
{
    const facts = readFileSync(join('lambda', 'ai-worker', 'src', 'report', 'facts.ts'), 'utf8')
    check('the report takes its record rule from lib/report/records.ts, and has no copy of its own',
        facts.includes("from '../../../../lib/report/records'") && !/function liftMeasure/.test(facts))
}

// The award exercises are the library's: the barbell lift, and pull-ups in any grip
{
    const library = JSON.parse(readFileSync(join('supabase', 'data', 'exercise-attributes.json'), 'utf8')) as { id: string; name: string; equipment: string; logType: string }[]
    const byId = new Map(library.map((e) => [e.id, e]))
    for (const [award, ids] of Object.entries(AWARD_EXERCISES)) {
        const found = ids.map((id) => byId.get(id))
        const want = award === 'pullup' ? { equipment: 'bodyweight', logType: 'bodyweight' } : { equipment: 'barbell', logType: 'weight_reps' }
        check(`${award}: its exercises are in the library, ${want.equipment} and ${want.logType}`,
            found.every((e) => e && e.equipment === want.equipment && e.logType === want.logType), JSON.stringify(found.map((e) => e?.name ?? null)))
    }
}

// The migration reads the strength log types the rule knows, as the user
{
    const migration = readFileSync(join('supabase', 'migrations', '20261102120000_awards_page.sql'), 'utf8')
    const listed = migration.match(/e\.log_type in \(([^)]*)\)/)?.[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
    check('awards_page reads the log types of STRENGTH_LOG_TYPES', same(listed, [...STRENGTH_LOG_TYPES].sort()), JSON.stringify(listed))
    check('awards_page runs as the user, and anon can\'t call it', migration.includes('security invoker') && migration.includes('from public, anon'))
}

if (failed) {
    console.log(`\n${failed} check(s) failed`)
    process.exit(1)
}
console.log('\nAll awards checks pass')
