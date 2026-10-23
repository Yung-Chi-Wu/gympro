import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EQUIPMENT_SECTIONS, exerciseSections, getExerciseName, RECENT_SHOWN } from '../lib/exercise-display'

// How the exercise picker lists a muscle group (2026-10-23): done lately first, then by equipment,
// each exercise once, so more exercises stay easy to look through. In CI: npm run check:exercise-picker

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

// The built-in library, as the migrations insert it (id, name, name_zh_tw, muscle_group, equipment)
type Row = { id: string; name: string; name_zh_tw: string; muscle_group: string; equipment: string; recent?: number }
const library: Row[] = readFileSync(join(__dirname, '..', '..', 'evals', 'search', 'library.csv'), 'utf8')
    .trim().split('\n').slice(1)
    .map((line) => {
        const [id, name, name_zh_tw, muscle_group, equipment] = line.split(',')
        return { id, name, name_zh_tw, muscle_group, equipment }
    })
const groups = [...new Set(library.map((ex) => ex.muscle_group))]

for (const language of ['en', 'zh-TW']) {
    const all = groups.flatMap((g) => exerciseSections(library.filter((ex) => ex.muscle_group === g), language))
    const listed = all.flatMap((s) => s.exercises.map((ex) => ex.id))
    check(`${language}: every exercise is listed once (${listed.length})`, listed.length === library.length && new Set(listed).size === library.length)
    check(`${language}: sections are in order and none is empty`, all.every((s) => s.exercises.length) && groups.every((g) => {
        const keys = exerciseSections(library.filter((ex) => ex.muscle_group === g), language).map((s) => s.key)
        return keys.every((k, i) => i === 0 || EQUIPMENT_SECTIONS.indexOf(k as never) > EQUIPMENT_SECTIONS.indexOf(keys[i - 1] as never))
    }))
    const collator = new Intl.Collator(language === 'zh-TW' ? 'zh-Hant-TW' : 'en')
    check(`${language}: each section is by name in the language shown`, all.every((s) => s.exercises.every((ex, i) => i === 0 || collator.compare(getExerciseName(s.exercises[i - 1], language), getExerciseName(ex, language)) <= 0)))
}
const kettlebell = library.find((ex) => ex.equipment === 'kettlebell')
check('equipment with no section of its own is under other', !!kettlebell && exerciseSections([kettlebell], 'en')[0].key === 'other')

const legs = library.filter((ex) => ex.muscle_group === 'legs')
const done = legs.slice(0, RECENT_SHOWN + 2).map((ex, i) => ({ ...ex, recent: RECENT_SHOWN + 1 - i }))
const withDone = [...legs.slice(RECENT_SHOWN + 2), ...done]
const sections = exerciseSections(withDone, 'zh-TW')
const recent = sections[0]
check(`done lately heads the group, ${RECENT_SHOWN} at most, the latest on top`, recent.key === 'recent' && recent.label === '最近做過' && recent.exercises.length === RECENT_SHOWN && recent.exercises.every((ex, i) => ex.recent === i), recent.exercises.map((ex) => ex.recent).join(','))
const rest = sections.slice(1).flatMap((s) => s.exercises)
check('the rest, older ones included, are listed under their equipment', rest.length === legs.length - RECENT_SHOWN && !rest.some((ex) => recent.exercises.includes(ex)))
check('no section for done lately when nothing was', exerciseSections(legs, 'en')[0].key !== 'recent')

console.log(failed ? `\n${failed} picker check(s) failed` : '\nThe exercise picker lists every group as expected')
process.exit(failed ? 1 : 0)
