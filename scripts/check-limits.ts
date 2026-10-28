import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPS, SETS } from '../lib/coach-g'
import { isValidField, MIN_AVG_HR, STORED_MAX, type Units } from '../lib/set-log'
import { isTarget, TARGET_REPS, TARGET_SETS } from '../lib/targets'
import { answersGoalText, GOAL_CHOICES, goalText } from '../lib/goal-choices'
import { MAX_TRAINING_GOAL_CHARS } from '../lib/text-limits'

// The limits on what a user types: a set's amounts in any unit, and a routine's targets. The app
// and the tables must agree, or a value the app lets through fails on save, so the migrations'
// numbers are read here too. In CI: npm run check:limits

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

const metric: Units = { weight: 'kg', distance: 'km' }
const imperial: Units = { weight: 'lb', distance: 'mi' }
const cases: [string, Parameters<typeof isValidField>[0], string, Units, boolean][] = [
    ['1000 kg', 'weight', '1000', metric, true],
    ['1000.5 kg', 'weight', '1000.5', metric, false],
    ['2204 lb (999.7 kg)', 'weight', '2204', imperial, true],
    ['2210 lb (1002.4 kg)', 'weight', '2210', imperial, false],
    ['500 kg of assistance', 'assist', '500', metric, true],
    ['501 kg of assistance', 'assist', '501', metric, false],
    ['1000 reps', 'reps', '1000', metric, true],
    ['1001 reps', 'reps', '1001', metric, false],
    ['86400 s', 'seconds', '86400', metric, true],
    ['86401 s', 'seconds', '86401', metric, false],
    ['1440 min', 'minutes', '1440', metric, true],
    ['1441 min', 'minutes', '1441', metric, false],
    ['50 km/h', 'speed', '50', metric, true],
    ['51 km/h', 'speed', '51', metric, false],
    ['31 mph (49.9 km/h)', 'speed', '31', imperial, true],
    ['32 mph (51.5 km/h)', 'speed', '32', imperial, false],
    ['40% incline', 'incline', '40', metric, true],
    ['41% incline', 'incline', '41', metric, false],
    ['level 100', 'level', '100', metric, true],
    ['level 101', 'level', '101', metric, false],
    ['100000 m', 'metres', '100000', metric, true],
    ['100001 m', 'metres', '100001', metric, false],
    ['0 kg (bodyweight alone)', 'added', '0', metric, true],
    ['0 reps', 'reps', '0', metric, false],
    ['-5 kg', 'weight', '-5', metric, false],
    ['8.5 reps', 'reps', '8.5', metric, false],
    ['nothing typed', 'reps', '', metric, false],
    // Heart rate is optional: empty is a value, and the rest are whole bpm in the table's range
    ['no heart rate typed', 'hr', '', metric, true],
    ['30 bpm', 'hr', '30', metric, true],
    ['29 bpm', 'hr', '29', metric, false],
    ['250 bpm', 'hr', '250', metric, true],
    ['251 bpm', 'hr', '251', metric, false],
    ['142.5 bpm', 'hr', '142.5', metric, false],
]
const wrong = cases.filter(([, key, text, units, ok]) => isValidField(key, text, units) !== ok).map(([name]) => name)
check(`a set's amounts are held to the table's limits in the unit typed (${cases.length} cases)`, !wrong.length, wrong.join(', '))

check('targets are whole numbers, 1-20 sets and 1-100 reps',
    isTarget(1, TARGET_SETS) && isTarget(20, TARGET_SETS) && !isTarget(0, TARGET_SETS) && !isTarget(21, TARGET_SETS) && !isTarget(2.5, TARGET_SETS)
    && isTarget(100, TARGET_REPS) && !isTarget(101, TARGET_REPS))
check("Coach G's plans stay inside the targets the table takes",
    SETS.min >= TARGET_SETS.min && SETS.max <= TARGET_SETS.max && REPS.min >= TARGET_REPS.min && REPS.max <= TARGET_REPS.max,
    JSON.stringify({ SETS, REPS, TARGET_SETS, TARGET_REPS }))

// The numbers in the migrations, as the app's
const migration = (name: string) => readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', name), 'utf8')
const limits = migration('20261017130000_routine_and_set_limits.sql')
const amounts = migration('20261010140000_set_log_types.sql')
const heartRate = migration('20261023140000_set_average_heart_rate.sql')
const has = (sql: string, pattern: string) => sql.includes(pattern)
const sqlMatches: [string, boolean][] = [
    [`target_sets between ${TARGET_SETS.min} and ${TARGET_SETS.max}`, has(limits, `target_sets between ${TARGET_SETS.min} and ${TARGET_SETS.max}`)],
    [`target_reps between ${TARGET_REPS.min} and ${TARGET_REPS.max}`, has(limits, `target_reps between ${TARGET_REPS.min} and ${TARGET_REPS.max}`)],
    [`reps <= ${STORED_MAX.reps}`, has(limits, `reps <= ${STORED_MAX.reps}`)],
    [`weight_kg <= ${STORED_MAX.weightKg}`, has(limits, `weight_kg <= ${STORED_MAX.weightKg}`)],
    [`assist_kg <= ${STORED_MAX.assistKg}`, has(limits, `assist_kg <= ${STORED_MAX.assistKg}`)],
    [`duration_s <= ${STORED_MAX.durationS}`, has(limits, `duration_s <= ${STORED_MAX.durationS}`)],
    [`level <= ${STORED_MAX.level}`, has(limits, `level <= ${STORED_MAX.level}`)],
    [`distance_m <= ${STORED_MAX.distanceM}`, has(limits, `distance_m <= ${STORED_MAX.distanceM}`)],
    [`speed_kmh between 0 and ${STORED_MAX.speedKmh}`, has(amounts, `speed_kmh between 0 and ${STORED_MAX.speedKmh}`)],
    [`incline_pct between 0 and ${STORED_MAX.inclinePct}`, has(amounts, `incline_pct between 0 and ${STORED_MAX.inclinePct}`)],
    [`avg_hr between ${MIN_AVG_HR} and ${STORED_MAX.avgHr}`, has(heartRate, `avg_hr between ${MIN_AVG_HR} and ${STORED_MAX.avgHr}`)],
]
const missing = sqlMatches.filter(([, ok]) => !ok).map(([p]) => p)
check(`the migrations' limits are the app's (${sqlMatches.length})`, !missing.length, missing.join('; '))

// The goal onboarding writes: the kinds picked, then the user's own words, as one text the
// report's goal reader reads. It stays inside training_goal's limit however much is typed
const goalCases: [string[], string, boolean, string][] = [
    [['muscle', 'strength'], '深蹲 140 kg', true, '增肌、力量。深蹲 140 kg'],
    [['muscle', 'strength'], '', false, 'Muscle, Strength'],
    [['physique', 'fat_loss'], ' get down to 165 lb ', false, 'Fat loss, Physique. get down to 165 lb'],
    [[], '減到 75 公斤', true, '減到 75 公斤'],
    [[], '   ', true, ''],
]
for (const [kinds, words, zh, want] of goalCases) {
    const got = goalText(kinds, words, zh)
    check(`goal from ${JSON.stringify(kinds)} and ${JSON.stringify(words)}`, got === want, `got ${JSON.stringify(got)}`)
}
// Coach G's goal answers, offered as the goal after its plan is saved
const answerCases: [string[], boolean, string][] = [
    [['增肌', '增強力量'], true, '增肌、增強力量'],
    [[' Build muscle ', 'Build muscle', '', 'Lose fat'], false, 'Build muscle, Lose fat'],
    [['  '], true, ''],
]
for (const [answers, zh, want] of answerCases) {
    const got = answersGoalText(answers, zh)
    check(`goal from Coach G's answers ${JSON.stringify(answers)}`, got === want, `got ${JSON.stringify(got)}`)
}
check(`a goal from Coach G's answers fits training_goal (${MAX_TRAINING_GOAL_CHARS})`,
    answersGoalText(Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(60, 'x')), true).length <= MAX_TRAINING_GOAL_CHARS)
check(`a goal from every kind and the longest words fits training_goal (${MAX_TRAINING_GOAL_CHARS})`,
    goalText(GOAL_CHOICES.map((c) => c.key), 'x'.repeat(MAX_TRAINING_GOAL_CHARS), true).length <= MAX_TRAINING_GOAL_CHARS)
check(`training_goal's limit is the table's (${MAX_TRAINING_GOAL_CHARS})`,
    has(migration('20261014140000_ronnie_server_writes.sql'), `char_length(training_goal) <= ${MAX_TRAINING_GOAL_CHARS}`))

if (failed) {
    console.log(`\n${failed} check(s) failed`)
    process.exit(1)
}
console.log('\nWhat a user types is held to the same limits in the app and the tables')
