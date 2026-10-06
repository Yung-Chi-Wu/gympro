#!/usr/bin/env node
// Offline checks of the Ronnie grader - no API calls. An ideal conversation
// built for every case must pass every programmatic check, and degenerate
// agents (silent, giving up, inventing ids, acting too early) must fail.
//   npm run eval:ronnie:build && node evals/ronnie/check-grader.mjs

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exercisesMentioned, overallPass, programmaticGrade } from './grade.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { EXERCISES } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'))
const id = (name) => EXERCISES.find((e) => e.name === name).id
const OP_TOOL = { add_today: 'add_exercise_today', remove_today: 'remove_exercise_today', delete_from_routines: 'remove_exercise_from_routine' }
// What an ideal reply names when a case says "add what you recommended"
const RECOMMEND = { 'zh-TW': ['啞鈴後三角飛鳥', 'Rear Delt Dumbbell Fly'], en: ['Incline Barbell Press', 'Incline Barbell Press'] }

let failures = 0
const check = (cond, msg) => { if (!cond) { failures++; console.log(`FAIL ${msg}`) } }

/** The conversation a perfect Ronnie would produce for this case. */
function oracle(c) {
    const exp = c.expect
    const zh = c.language === 'zh-TW'
    const turns = c.turns.map((user) => ({ user, toolCalls: [], writes: [], message: zh ? '好的，沒問題，這是你要的資訊。' : 'Sure, here is what you asked for.' }))
    const last = turns.at(-1)
    for (const name of exp.tools_required ?? []) {
        const input = name === 'get_workout_history' && exp.history_range
            ? { date_from: exp.history_range.cover[0], date_to: exp.history_range.cover[1] }
            : {}
        last.toolCalls.push({ name, input, result: 'ok' })
    }
    for (const w of exp.writes ?? []) {
        let exerciseId
        if (w.exercise === '$recommended') {
            const [shown, english] = RECOMMEND[c.language]
            turns[w.turn - 2].message += zh ? `推薦你做${shown}。` : ` Try the ${shown}.`
            exerciseId = id(english)
        } else exerciseId = id(w.exercise)
        turns[w.turn - 1].toolCalls.push({ name: OP_TOOL[w.op], input: { exercise_id: exerciseId }, result: 'ok' })
        turns[w.turn - 1].writes.push({ op: w.op, exerciseId })
    }
    if (exp.mentions) last.message += exp.mentions.join('、')
    return { turns, writes: turns.flatMap((t) => t.writes) }
}

function programmatic_fail(c, out) { return programmaticGrade(c, out, EXERCISES).grade.writes_correct === 0 }
const withMessages = (out, message) => ({ ...out, turns: out.turns.map((t) => ({ ...t, message })) })

for (const c of cases) {
    const ideal = oracle(c)
    const { grade, explanation } = programmaticGrade(c, ideal, EXERCISES)
    check(overallPass(grade) === 1, `${c.id}: ideal conversation should pass, got ${JSON.stringify(grade)} ${JSON.stringify(explanation)}`)
    check(overallPass(programmaticGrade(c, withMessages(ideal, ''), EXERCISES).grade) === 0, `${c.id}: empty replies should fail`)
    const fallback = c.language === 'zh-TW' ? '抱歉，請再問一次。' : 'Sorry, please try again.'
    check(overallPass(programmaticGrade(c, withMessages(ideal, fallback), EXERCISES).grade) === 0, `${c.id}: giving up should fail`)

    // Doing the wrong thing: delete burpees from every routine on every case
    const reckless = { ...ideal, turns: ideal.turns.map((t) => ({ ...t, toolCalls: [...t.toolCalls, { name: 'remove_exercise_from_routine', input: {}, result: 'ok' }], writes: [...t.writes, { op: 'delete_from_routines', exerciseId: id('Burpee') }] })) }
    reckless.writes = reckless.turns.flatMap((t) => t.writes)
    if (c.expect.writes) check(programmaticGrade(c, reckless, EXERCISES).grade.writes_correct === 0, `${c.id}: an unrequested permanent delete should fail writes_correct`)
}

// The lost-id bug: adding with an invented id, or adding before the user agreed
const twoTurn = cases.find((c) => c.id === 'add-after-recommend-zh')
const good = oracle(twoTurn)
const invented = structuredClone(good)
invented.turns[1].writes = [{ op: 'add_today', exerciseId: '00000000-0000-0000-0000-000000000000' }]
invented.writes = invented.turns.flatMap((t) => t.writes)
const g1 = programmaticGrade(twoTurn, invented, EXERCISES).grade
check(g1.valid_ids === 0 && g1.writes_correct === 0, `invented id should fail valid_ids and writes_correct, got ${JSON.stringify(g1)}`)
const early = structuredClone(good)
early.turns[0].writes = early.turns[1].writes
early.turns[1].writes = []
early.writes = early.turns.flatMap((t) => t.writes)
check(programmaticGrade(twoTurn, early, EXERCISES).grade.writes_correct === 0, 'adding in turn 1, before the user agreed, should fail')
const other = structuredClone(good)
other.turns[1].writes = [{ op: 'add_today', exerciseId: id('Face Pull') }]
other.writes = other.turns.flatMap((t) => t.writes)
check(programmaticGrade(twoTurn, other, EXERCISES).grade.writes_correct === 0, 'adding a different exercise than the one recommended should fail')

// Two exercises recommended: asking which one passes; adding nothing without asking fails
const enTwo = cases.find((c) => c.id === 'add-after-recommend-en')
const asked = oracle(enTwo)
asked.turns[0].message = 'Try the Incline Barbell Press or the Incline Dumbbell Press.'
asked.turns[1] = { ...asked.turns[1], toolCalls: [], writes: [], message: 'Which one do you want, barbell or dumbbell?' }
asked.writes = []
check(programmaticGrade(enTwo, asked, EXERCISES).grade.writes_correct === 1, 'asking which of two recommendations should pass')
const silent = structuredClone(asked)
silent.turns[1].message = 'OK, done!'
check(programmatic_fail(enTwo, silent), 'claiming done without adding anything should fail')
const oneRec = structuredClone(asked)
oneRec.turns[0].message = 'Try the Incline Barbell Press.'
check(programmatic_fail(enTwo, oneRec), 'with a single recommendation, asking again instead of adding should fail')

// Recommended under a non-library name, then asked which library exercise: clarifying, passes
const offeredQ = structuredClone(asked)
offeredQ.turns[0].message = 'Incline bench press is the king for upper chest.'
offeredQ.turns[1].message = 'Do you want the Incline Barbell Press or the Incline Dumbbell Press?'
check(programmaticGrade(enTwo, offeredQ, EXERCISES).grade.writes_correct === 1, 'a question offering two library exercises should count as clarifying')

// The English catchphrase must not make a Chinese reply count as English
check(programmaticGrade(cases[0], { ...oracle(cases[0]), turns: oracle(cases[0]).turns.map((t) => ({ ...t, message: t.message + " Ain't nothin' but a peanut! 💪 衝吧 Alex！" })) }, EXERCISES).grade.language_correct === 1, 'catchphrase should not fail the language check')

// Rolling seven days is not "last week"
const lastWeek = cases.find((c) => c.id === 'history-last-week-zh')
const rolling = oracle(lastWeek)
rolling.turns[0].toolCalls[0].input = { date_from: '2026-09-30', date_to: '2026-10-06' }
check(programmaticGrade(lastWeek, rolling, EXERCISES).grade.date_range === 0, '9/30-10/6 should not count as last week')

// Name matching: longest name wins, English plurals count
const m1 = exercisesMentioned('推薦上斜啞鈴臥推', EXERCISES)
check(m1.has(id('Incline Dumbbell Press')) && !m1.has(id('Dumbbell Bench Press')), '上斜啞鈴臥推 must not also match 啞鈴臥推')
const m2 = exercisesMentioned('Romanian deadlifts and face pulls', EXERCISES)
check(m2.has(id('Romanian Deadlift')) && !m2.has(id('Deadlift')) && m2.has(id('Face Pull')), 'plural/case-insensitive English names, longest match')

console.log(failures ? `\n${failures} grader check(s) failed` : `\nGrader behaves as expected (${cases.length} oracle cases + negative controls)`)
process.exit(failures ? 1 : 0)
