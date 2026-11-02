// Free check of 成就 (lib/awards.ts): each award's best and the day each mark was first reached,
// worked out from awards_page's answer in the user's zone and unit. A lift by its heaviest single
// or a 2-10 rep set's estimated 1RM, in the unit shown or the one typed, so switching units takes
// nothing away. Training days and weeks from the workouts, stronger lifts against the user's own
// start, new bests by the report's own rule (lib/report/records.ts), one a day per exercise. That
// the report uses the same rule, the award exercises are the library's, and the migration reads
// the strength log types the rule knows.
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
    { id: 'row', log_type: 'weight_reps', muscle_group: 'back' },
    { id: PULL_UP, log_type: 'bodyweight', muscle_group: 'back' },
    { id: CHIN_UP, log_type: 'bodyweight', muscle_group: 'back' },
    { id: 'curl', log_type: 'weight_reps', muscle_group: 'arms' },
    { id: 'apu', log_type: 'assisted', muscle_group: 'back' },
    { id: 'crunch', log_type: 'weight_reps', muscle_group: 'core' },
    { id: 'tread', log_type: 'treadmill', muscle_group: 'cardio' },
]
/** A set at noon UTC on `date`, typed in `unit` */
const set = (exerciseId: string, date: string, kg: number, reps: number, assist: number | null = null, unit: string | null = 'kg'): AwardsPage['sets'][number] =>
    [exerciseId, `${date}T12:00:00+00:00`, kg, reps, assist, unit]
const page = (sets: AwardsPage['sets'], workouts: string[] = []): AwardsPage => ({ sets, exercises, workouts })
const track = (tracks: AwardTrack[], id: AwardId) => tracks.find((t) => t.id === id)!
const kg = { timeZone: 'UTC', weightUnit: 'kg' } as const

// A lift: its heaviest single, or a set of 2-10 reps by its estimated 1RM, and the first day each mark was reached
{
    const tracks = awardTracks(page([
        set(SQUAT, '2026-09-01', 60, 1),
        set(SQUAT, '2026-09-08', 90, 3),           // est. 99
        set(SQUAT, '2026-09-15', 80, 8),           // est. 101.3: silver without a single
        set(SQUAT, '2026-09-22', 80, 20),          // counted as 10 reps: est. 106.7, not 133
        set(SQUAT, '2026-09-29', 150, 0),          // no rep: not a lift
    ]), kg)
    const squat = track(tracks, 'squat')
    check('a lift reads its heaviest single or a set\'s estimated 1RM, reps past 10 counted as 10, and never a 0-rep set',
        Math.abs(squat.best - 106.67) < 0.01 && squat.estimated === true, JSON.stringify(squat))
    check('each mark is dated the day it was first reached: silver by an estimate, so no one has to test a max',
        same(squat.reached, ['2026-09-01', '2026-09-15', null]), JSON.stringify(squat.reached))
    check('a single\'s best is its weight, not an estimate', track(awardTracks(page([set(SQUAT, '2026-09-01', 70, 1)]), kg), 'squat').estimated === false)
    check('a user who never logged a lift has none of its marks', same(track(tracks, 'bench'), { id: 'bench', tiers: LIFT_TIERS.bench.kg, best: 0, estimated: false, reached: [null, null, null] }))
}

// lb: the marks are the user's, and a set typed as 225 lb reaches 225 lb after it is stored in kg
{
    const squat = track(awardTracks(page([set(SQUAT, '2026-09-01', toStorageKg(225, 'lb'), 1, null, 'lb')]), { timeZone: 'UTC', weightUnit: 'lb' }), 'squat')
    check('225 lb logged reaches the 225 lb mark', squat.best === 225 && same(squat.reached, ['2026-09-01', '2026-09-01', null]), JSON.stringify(squat))
}

// Switching units takes nothing away: a set exactly on a kg mark keeps it in lb, and the other way round
{
    const inLb = track(awardTracks(page([set(SQUAT, '2026-09-01', 100, 1, null, 'kg')]), { timeZone: 'UTC', weightUnit: 'lb' }), 'squat')
    check('100 kg typed in kg keeps the squat silver when lb is shown, though 220.5 lb is under 225',
        inLb.reached[1] === '2026-09-01' && inLb.best === 220.5, JSON.stringify(inLb))
    const inKg = track(awardTracks(page([[AWARD_EXERCISES.press[0], '2026-09-01T12:00:00+00:00', toStorageKg(65, 'lb'), 1, null, 'lb']]), kg), 'press')
    check('65 lb typed in lb keeps the press bronze when kg is shown, though 29.5 kg is under 30', inKg.reached[0] === '2026-09-01', JSON.stringify(inKg))
    const older = track(awardTracks(page([set(SQUAT, '2026-09-01', 100, 1, null, null)]), { timeZone: 'UTC', weightUnit: 'lb' }), 'squat')
    check('a set from before units were kept counts in either unit', older.reached[1] === '2026-09-01', JSON.stringify(older))
}

// The day is the user's: a workout at 03:00 UTC is the evening before in New York
{
    const squat = track(awardTracks(page([[SQUAT, '2026-10-01T03:00:00+00:00', 60, 1, null, 'kg']]), { timeZone: 'America/New_York', weightUnit: 'kg' }), 'squat')
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

// Training days and training weeks: from the workouts, cardio included, never in a row
{
    const at = (date: string, hour = 12) => `${date}T${String(hour).padStart(2, '0')}:00:00+00:00`
    const tracks = awardTracks(page([], [
        at('2026-09-01'), at('2026-09-01', 18),                       // Tue, twice: one day
        at('2026-09-03'),                                             // Thu: the week's second day
        at('2026-09-07'),                                             // Mon: one day, no week
        at('2026-09-15'), at('2026-09-20'),                           // Tue and Sun: a week
        at('2026-09-21'), at('2026-09-22'), at('2026-09-23'),         // three days: still one week
    ]), kg)
    const days = track(tracks, 'days'), weeks = track(tracks, 'weeks')
    check('training days count each day with a workout once', days.best === 8, JSON.stringify(days))
    check('a training week is a Monday-to-Sunday week with 2 days or more, dated the day it got its second, and a week with one day breaks nothing',
        weeks.best === 3 && same(weeks.reached, [null, null, null]), JSON.stringify(weeks))
    const many = track(awardTracks(page([], Array.from({ length: 4 }, (_, w) => [at(`2026-10-${String(5 + 7 * w).padStart(2, '0')}`), at(`2026-10-${String(7 + 7 * w).padStart(2, '0')}`)]).flat()), kg), 'weeks')
    check('the fourth training week reaches bronze on its second day', many.reached[0] === '2026-10-28', JSON.stringify(many))
    check('without workouts read (before the migration) there are no training days, and nothing fails', track(awardTracks({ sets: [], exercises }, kg), 'days').best === 0)
}

// Stronger lifts: up a fifth on the user's own first two weeks with the lift, big lifts only
{
    const stronger = track(awardTracks(page([
        set('row', '2026-09-01', 50, 10),           // est. 66.7: the start
        set('row', '2026-09-10', 55, 8),            // still in the first two weeks: the start is 69.7
        set('row', '2026-09-20', 60, 8),            // est. 76: up 9%
        set('row', '2026-10-01', 65, 10),           // est. 86.7: up 24%
        set(SQUAT, '2026-09-01', 100, 5),
        set(SQUAT, '2026-09-30', 115, 5),           // up 15%: not yet
        set('curl', '2026-09-01', 10, 10),
        set('curl', '2026-10-01', 20, 10),          // doubled, but an isolation lift
    ]), kg), 'stronger')
    check('a stronger lift is up 20% on the best of its first 14 days, dated the day it got there; an isolation lift never counts',
        stronger.best === 1 && stronger.reached[0] === '2026-10-01', JSON.stringify(stronger))
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
    const migration = readFileSync(join('supabase', 'migrations', '20261102180000_awards_page_units_days.sql'), 'utf8')
    const listed = migration.match(/e\.log_type in \(([^)]*)\)/)?.[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort()
    check('awards_page reads the log types of STRENGTH_LOG_TYPES', same(listed, [...STRENGTH_LOG_TYPES].sort()), JSON.stringify(listed))
    check('awards_page runs as the user, and anon can\'t call it', migration.includes('security invoker') && migration.includes('from public, anon'))
    check('awards_page leaves a set out only for one typed in the same unit', migration.includes('t.input_unit is not distinct from s.input_unit'))
}

if (failed) {
    console.log(`\n${failed} check(s) failed`)
    process.exit(1)
}
console.log('\nAll awards checks pass')
