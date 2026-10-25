// Free check of how a set is entered and read on Today (components/TodayWorkoutCard.tsx):
// - the next set starts as a copy of the set before it today, in the units shown, and the copy
//   is a valid set, so ＋ takes it as it is;
// - a logged set reads in the column's unit like the rest of the table (63 kg is 138.9 under
//   lb), while the set keeps what was typed, so switching back reads the same number again;
// - a value changed under lb is kept as typed in lb, and changing the reps leaves the weight.
//   npm run check:set-entry
import { cellText } from '../components/set-format'
import type { LogType } from '../lib/exercise-attributes'
import { isValidField, LOG_FIELDS, nextSetDraft, toStoredSet, withField, type SetValues, type Units } from '../lib/set-log'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const KG: Units = { weight: 'kg', distance: 'km' }
const LB: Units = { weight: 'lb', distance: 'km' }
const MI: Units = { weight: 'kg', distance: 'mi' }
// cellText only asks for the bodyweight word
const t = ((key: string) => (key === 'bodyweight' ? 'BW' : key)) as unknown as Parameters<typeof cellText>[0]
const cells = (s: SetValues, units: Units, fields = LOG_FIELDS.weight_reps) => fields.map((key) => cellText(t, key, s, units))

// As the app stores them: typed in the units shown
const kgSet = toStoredSet('weight_reps', [63, 12], KG)
const lbSet = toStoredSet('weight_reps', [80, 10], LB)

// ---------- The next set ----------
check('with no set yet today, the next set starts empty (last time\'s values are only hints)',
    same(nextSetDraft('weight_reps', [], KG), ['', '']))
check('after 63 kg x 12, the next set starts as 63 and 12', same(nextSetDraft('weight_reps', [kgSet], KG), ['63', '12']))
check('the copy is of the last set, not the first', same(nextSetDraft('weight_reps', [lbSet, kgSet], KG), ['63', '12']))
check('under lb the copy is in lb: 138.9 and 12', same(nextSetDraft('weight_reps', [kgSet], LB), ['138.9', '12']))
check('80 lb typed under lb is copied as 80 again, not a rounded 80.01', same(nextSetDraft('weight_reps', [lbSet], LB), ['80', '10']))
check('a set logged another way (weight and reps, where the exercise now logs seconds) gives no copy', same(nextSetDraft('duration', [kgSet], KG), ['']))
{
    const run = toStoredSet('treadmill', [20, 10, 1, null], KG)
    check('a treadmill set is copied field by field, an empty heart rate left empty', same(nextSetDraft('treadmill', [run], KG), ['20', '10', '1', '']))
    check('and its speed in mph when the distance unit is miles', nextSetDraft('treadmill', [run], MI)[1] === '6.2', nextSetDraft('treadmill', [run], MI).join())
}
{
    const sets: [string, LogType, SetValues, Units][] = [
        ['weight and reps', 'weight_reps', kgSet, LB],
        ['bodyweight', 'bodyweight', toStoredSet('bodyweight', [0, 15], KG), KG],
        ['added weight', 'bodyweight', toStoredSet('bodyweight', [10, 8], KG), LB],
        ['assisted', 'assisted', toStoredSet('assisted', [20, 8], KG), LB],
        ['treadmill', 'treadmill', toStoredSet('treadmill', [20, 10, 1, 140], KG), MI],
        ['rower', 'rower', toStoredSet('rower', [10, 2000, null], KG), KG],
    ]
    const invalid = sets.flatMap(([what, logType, set, units]) => {
        const draft = nextSetDraft(logType, [set], units)
        return LOG_FIELDS[logType].flatMap((key, i) => (isValidField(key, draft[i], units) ? [] : [`${what}: ${key} "${draft[i]}"`]))
    })
    check('every copy is a valid set as it stands, so ＋ takes it without typing', invalid.length === 0, invalid.join(', '))
}

// ---------- A logged set's cells ----------
check('63 kg reads 63 under kg', same(cells(kgSet, KG), ['63', '12']))
check('and 138.9 under lb, with no "kg" left in the lb column', same(cells(kgSet, LB), ['138.9', '12']))
check('80 lb reads 80 under lb, and 36.29 under kg', same(cells(lbSet, LB), ['80', '10']) && same(cells(lbSet, KG), ['36.29', '10']), `${cells(lbSet, LB)} / ${cells(lbSet, KG)}`)
{
    const bw = toStoredSet('bodyweight', [0, 15], KG)
    const added = toStoredSet('bodyweight', [10, 8], KG)
    check('bodyweight reads BW, and +10 kg reads +22 under lb', same(cells(bw, LB, LOG_FIELDS.bodyweight), ['BW', '15']) && same(cells(added, LB, LOG_FIELDS.bodyweight), ['+22', '8']),
        `${cells(bw, LB, LOG_FIELDS.bodyweight)} / ${cells(added, LB, LOG_FIELDS.bodyweight)}`)
}

// ---------- Changing a logged set ----------
{
    const changed = withField(kgSet, 'weight', 140, LB)
    check('140 typed over 138.9 under lb is kept as typed in lb', changed.inputUnit === 'lb' && cells(changed, LB)[0] === '140', `${changed.inputUnit} ${cells(changed, LB)}`)
    const reps = withField(kgSet, 'reps', 10, LB)
    check('changing the reps under lb leaves the weight as typed: still 63 kg', reps.weightKg === 63 && reps.inputUnit === 'kg' && reps.reps === 10, JSON.stringify(reps))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
