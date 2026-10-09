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
// The held-out cases are graded by the same rules, so their oracles are checked too
const cases = ['cases.json', 'cases-holdout.json'].flatMap((f) => JSON.parse(readFileSync(join(here, f), 'utf8')))
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
    // App-event steps are not turns: the user tapped a button, Ronnie didn't reply
    const turns = c.turns.filter((t) => typeof t === 'string').map((user) => ({ user, toolCalls: [], writes: [], message: zh ? '好的，沒問題，這是你要的資訊。' : 'Sure, here is what you asked for.' }))
    const last = turns.at(-1)
    for (const name of exp.tools_required ?? []) {
        const input = name === 'get_workout_history' && exp.history_range
            ? { date_from: exp.history_range.cover[0], date_to: exp.history_range.cover[1] }
            : {}
        last.toolCalls.push({ name, input, result: 'ok' })
    }
    // A case may grade a date range without naming the tool; the ideal agent still queries it
    if (exp.history_range && !last.toolCalls.some((x) => x.input.date_from)) {
        last.toolCalls.push({ name: 'get_workout_history', input: { date_from: exp.history_range.cover[0], date_to: exp.history_range.cover[1] }, result: 'ok' })
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

// Changes are graded as two metrics; "writes ok" means neither a missed nor a wrong change
const writesOk = (g) => g.change_done !== 0 && g.no_wrong_change !== 0
function programmatic_fail(c, out) { return !writesOk(programmaticGrade(c, out, EXERCISES).grade) }
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
    if (c.expect.writes) check(programmaticGrade(c, reckless, EXERCISES).grade.no_wrong_change === 0, `${c.id}: an unrequested permanent delete should fail writes_correct`)
}

// The lost-id bug: adding with an invented id, or adding before the user agreed
const twoTurn = cases.find((c) => c.id === 'add-after-recommend-zh')
const good = oracle(twoTurn)
const invented = structuredClone(good)
invented.turns[1].writes = [{ op: 'add_today', exerciseId: '00000000-0000-0000-0000-000000000000', effective: false }]
invented.writes = invented.turns.flatMap((t) => t.writes)
const g1 = programmaticGrade(twoTurn, invented, EXERCISES).grade
check(g1.valid_ids === 0 && g1.change_done === 0 && overallPass(g1) === 0, `an invented id that adds nothing should fail, got ${JSON.stringify(g1)}`)
const early = structuredClone(good)
early.turns[0].writes = early.turns[1].writes
early.turns[1].writes = []
early.writes = early.turns.flatMap((t) => t.writes)
check(programmatic_fail(twoTurn, early), 'adding in turn 1, before the user agreed, should fail')
const other = structuredClone(good)
other.turns[1].writes = [{ op: 'add_today', exerciseId: id('Face Pull') }]
other.writes = other.turns.flatMap((t) => t.writes)
check(programmatic_fail(twoTurn, other), 'adding a different exercise than the one recommended should fail')

// Two exercises recommended: asking which one passes; adding nothing without asking fails
const enTwo = cases.find((c) => c.id === 'add-after-recommend-en')
const asked = oracle(enTwo)
asked.turns[0].message = 'Try the Incline Barbell Press or the Incline Dumbbell Press.'
asked.turns[1] = { ...asked.turns[1], toolCalls: [], writes: [], message: 'Which one do you want, barbell or dumbbell?' }
asked.writes = []
check(writesOk(programmaticGrade(enTwo, asked, EXERCISES).grade), 'asking which of two recommendations should pass')
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
check(writesOk(programmaticGrade(enTwo, offeredQ, EXERCISES).grade), 'a question offering two library exercises should count as clarifying')

// Recommended exercise already in today's workout: saying so instead of adding passes,
// but only when today's workout was actually checked and the reply names it
const planned = structuredClone(asked)
planned.turns[0].message = 'Try the Incline Dumbbell Press or the Incline Barbell Press.'
planned.turns[1] = { ...planned.turns[1], toolCalls: [{ name: 'get_today_workout', input: {}, result: `ID: ${id('Incline Dumbbell Press')} | Incline Dumbbell Press: no sets yet` }], writes: [], message: 'Incline Dumbbell Press is already in today\'s workout!' }
check(writesOk(programmaticGrade(enTwo, planned, EXERCISES).grade), 'already-planned recommendation should pass')
const unchecked = structuredClone(planned)
unchecked.turns[1].toolCalls = []
check(programmatic_fail(enTwo, unchecked), 'claiming it is already planned without checking today should fail')

// Recommended through a card (short id in the tool call), then added on request: passes
const carded = structuredClone(asked)
carded.turns[0] = { ...carded.turns[0], toolCalls: [{ name: 'recommend_exercise', input: { exercise_id: id('Incline Barbell Press').slice(0, 8) }, result: 'ok' }], message: 'This one hits your upper chest best 💪' }
carded.turns[1] = { ...carded.turns[1], toolCalls: [], writes: [{ op: 'add_today', exerciseId: id('Incline Barbell Press') }], message: 'Added!' }
carded.writes = carded.turns.flatMap((t) => t.writes)
check(overallPass(programmaticGrade(enTwo, carded, EXERCISES).grade) === 1, 'adding the exercise shown on the card should pass')

// A swap where Ronnie picks the substitute: it recommends and waits. Swapping before the
// user agreed fails; after a yes, adding without removing (the bug the user hit) or
// adding something other than the recommendation fails.
const swapAsk = cases.find((c) => c.id === 'swap-pick-zh')
const swappedEarly = structuredClone(oracle(swapAsk))
swappedEarly.turns[0].writes = [{ op: 'remove_today', exerciseId: id('Overhead Press') }, { op: 'add_today', exerciseId: id('Lateral Raise') }]
swappedEarly.writes = swappedEarly.turns.flatMap((t) => t.writes)
check(programmaticGrade(swapAsk, swappedEarly, EXERCISES).grade.no_wrong_change === 0, 'swapping before the user agreed should be a wrong change')
const swapYes = cases.find((c) => c.id === 'swap-confirm-zh')
const addedOnly = structuredClone(oracle(swapYes))
addedOnly.turns[1].writes = addedOnly.turns[1].writes.filter((w) => w.op === 'add_today')
addedOnly.writes = addedOnly.turns.flatMap((t) => t.writes)
check(programmaticGrade(swapYes, addedOnly, EXERCISES).grade.change_done === 0, 'adding the substitute without removing the old exercise should fail change_done')
const otherSub = structuredClone(oracle(swapYes))
otherSub.turns[1].writes = otherSub.turns[1].writes.map((w) => (w.op === 'add_today' ? { ...w, exerciseId: id('Face Pull') } : w))
otherSub.writes = otherSub.turns.flatMap((t) => t.writes)
check(programmatic_fail(swapYes, otherSub), 'swapping in something other than the recommendation should fail')

// The English catchphrase must not make a Chinese reply count as English
check(programmaticGrade(cases[0], { ...oracle(cases[0]), turns: oracle(cases[0]).turns.map((t) => ({ ...t, message: t.message + " Ain't nothin' but a peanut! 💪 衝吧 Alex！" })) }, EXERCISES).grade.language_correct === 1, 'catchphrase should not fail the language check')
check(programmaticGrade(cases[0], { ...oracle(cases[0]), turns: oracle(cases[0]).turns.map((t) => ({ ...t, message: '拉日有引體向上,槓鈴划船和滑輪下拉,要調整嗎?' })) }, EXERCISES).grade.language_correct === 0, 'half-width punctuation in a Chinese reply should fail the language check')
check(programmaticGrade(cases[0], { ...oracle(cases[0]), turns: oracle(cases[0]).turns.map((t) => ({ ...t, message: '每公斤 1.6–2.2 克，臥推 8×82.5kg，對吧？' })) }, EXERCISES).grade.language_correct === 1, 'decimals and full-width punctuation should pass the language check')

// A mis-copied id is rejected (changes nothing), then the retry with the right id
// works: the outcome is correct, so it passes, and valid_ids still records the slip
const removeToday = cases.find((c) => c.id === 'remove-today-zh')
const retried = oracle(removeToday)
retried.turns[0].writes = [{ op: 'remove_today', exerciseId: '13841865-fc8b-f679-bf4d-493b217d', effective: false }, ...retried.turns[0].writes]
retried.writes = retried.turns.flatMap((t) => t.writes)
const g2 = programmaticGrade(removeToday, retried, EXERCISES).grade
check(overallPass(g2) === 1 && g2.valid_ids === 0, `rejected attempt then a correct retry should pass with valid_ids 0, got ${JSON.stringify(g2)}`)

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
