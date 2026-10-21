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

// ---------- Memory cases ----------
const memoryCases = JSON.parse(readFileSync(join(here, 'cases-memory.json'), 'utf8'))
const OK_PICK = { knee: 'Romanian Deadlift', shoulder: 'Low-to-High Cable Fly' }
const asNote = (m) => ({ kind: m.kind, subject: m.kind === 'exercise' && m.subject ? id(m.subject) : m.subject ?? null, state: m.state ?? 'active', text: m.text ?? m.text_includes ?? 'x', updatedAt: '2026-10-01T02:00:00.000Z' })
const sameSlot = (a, b) => a.kind === b.kind && (a.subject ?? null) === (b.subject ?? null)

/** The conversations a perfect Ronnie with memory would produce for a memory case. */
function memoryOracle(c) {
    const exp = c.expect
    const zh = c.language === 'zh-TW'
    const sessions = c.sessions ?? [c.turns]
    const before = (c.memory ?? []).map(asNote)
    let after = before.map((n) => ({ ...n }))
    for (const [i, m] of (exp.memory_after ?? []).entries()) {
        if ('subject' in m) after = [...after.filter((n) => !sameSlot(n, asNote(m))), asNote(m)]
        else {
            // Any note of the kind: a new one, or at the kind's count folded into the first of them
            const full = exp.memory_count?.[m.kind] != null && after.filter((n) => n.kind === m.kind).length >= exp.memory_count[m.kind]
            const into = full ? after.find((n) => n.kind === m.kind) : null
            after = into ? after.map((n) => (n === into ? { ...n, text: `${n.text}；${m.text_includes}` } : n)) : [...after, { ...asNote(m), subject: `oracle-${i}` }]
        }
    }
    for (const m of exp.memory_absent ?? []) after = after.filter((n) => !(n.kind === m.kind && (!('subject' in m) || sameSlot(n, asNote(m))) && (!m.state || n.state === m.state)))
    const changed = JSON.stringify(after) !== JSON.stringify(before)
    const turns = sessions.flatMap((turnsOfDay, s) => turnsOfDay.map((user) => ({ user, session: s + 1, toolCalls: [], writes: [], memoryChanged: false, message: zh ? '好的，沒問題。' : 'Sure.' })))
    // The note is set in the first turn; the code's receipt says so
    if (changed) Object.assign(turns[0], { memoryChanged: true, message: zh ? '📝 我記住了。' : '📝 Saved.' })
    const last = turns.at(-1)
    for (const name of exp.tools_required ?? []) if (name !== 'recommend_exercise') last.toolCalls.push({ name, input: {}, result: 'ok' })
    if (exp.avoid) {
        const pick = exp.avoid.joint ? OK_PICK[exp.avoid.joint] : 'Plank'
        last.toolCalls.push({ name: 'recommend_exercise', input: { exercise_id: id(pick).slice(0, 8) }, result: 'ok' })
    }
    for (const w of exp.writes ?? []) turns[w.turn - 1].writes.push({ op: w.op, exerciseId: id(w.exercise) })
    if (exp.mentions) last.message = `${last.message}${exp.mentions.join('、')}`
    return { turns, writes: turns.flatMap((t) => t.writes), memoriesBefore: before, memories: after }
}
for (const c of memoryCases) {
    const good = memoryOracle(c)
    const g = programmaticGrade(c, good, EXERCISES).grade
    check(overallPass(g) === 1, `${c.id}: the ideal memory conversation should pass, got ${JSON.stringify(g)}`)
    if (c.expect.memory_after) {
        // A note to save fails when it isn't saved; one already held (keep it) fails when cleared
        const kept = c.expect.memory_after.every((m) => good.memoriesBefore.some((n) => sameSlot(n, asNote(m)) && n.state === asNote(m).state))
        const wrong = { ...structuredClone(good), memories: kept ? [] : structuredClone(good.memoriesBefore) }
        check(programmaticGrade(c, wrong, EXERCISES).grade.memory_right === 0, `${c.id}: ${kept ? 'clearing the note it should keep' : 'not saving the note'} should fail memory_right`)
    }
    if (c.expect.memory_after?.some((m) => m.text_includes)) {
        // Leaving the notes as they were fails: the fact was never saved, or the old note not changed
        check(programmaticGrade(c, { ...structuredClone(good), memories: structuredClone(good.memoriesBefore) }, EXERCISES).grade.memory_right === 0, `${c.id}: leaving the notes as they were should fail memory_right`)
    }
    for (const [kind] of Object.entries(c.expect.memory_count ?? {})) {
        // A second note on the same thing, instead of changing the old one
        const extra = structuredClone(good)
        extra.memories = [...extra.memories, { ...asNote({ kind, text: 'duplicate' }), subject: 'oracle-extra' }]
        check(programmaticGrade(c, extra, EXERCISES).grade.memory_right === 0, `${c.id}: one ${kind} note too many should fail memory_right`)
    }
    for (const m of (c.expect.memory_absent ?? []).filter((x) => !('subject' in x))) {
        // A note of a kind that must not have one (the wrist as other, not as an injury)
        const wrongKind = structuredClone(good)
        wrongKind.memories = [...wrongKind.memories, { ...asNote({ kind: m.kind, subject: m.kind === 'injury' ? 'knee' : 'oracle-wrong', text: 'x' }) }]
        check(programmaticGrade(c, wrongKind, EXERCISES).grade.memory_right === 0, `${c.id}: a ${m.kind} note should fail memory_right`)
    }
    if (c.expect.memory_unchanged) {
        const saved = structuredClone(good)
        saved.memories = [...saved.memories, asNote({ kind: 'exercise', subject: 'Overhead Press', state: 'dislike' })]
        check(programmaticGrade(c, saved, EXERCISES).grade.memory_right === 0, `${c.id}: saving a note in a conversation that shouldn't should fail`)
    }
    if (c.expect.avoid) {
        const bad = structuredClone(good)
        const badPick = c.expect.avoid.joint === 'knee' ? 'Back Squat' : c.expect.avoid.joint === 'shoulder' ? 'Barbell Bench Press' : c.expect.avoid.exercises[0]
        bad.turns.at(-1).toolCalls = bad.turns.at(-1).toolCalls.map((x) => (x.name === 'recommend_exercise' ? { ...x, input: { exercise_id: id(badPick).slice(0, 8) } } : x))
        check(programmaticGrade(c, bad, EXERCISES).grade.avoids_noted === 0, `${c.id}: recommending ${badPick} should fail avoids_noted`)
    }
    // Claiming to remember in a turn that saved nothing
    const claim = structuredClone(good)
    claim.turns = claim.turns.map((t) => ({ ...t, memoryChanged: false, message: c.language === 'zh-TW' ? '好，我記住了！' : "Got it, I'll remember that." }))
    check(programmaticGrade(c, claim, EXERCISES).grade.no_false_memory_claim === 0, `${c.id}: claiming to remember without saving should fail`)
}
// The claims the first version missed, word for word from the memory baseline (2026-10-13)
{
    const c = memoryCases.find((x) => x.id === 'memory-dislike-flip-zh')
    for (const message of ['好，記住了，之後我不會再推薦深蹲給你。', '已記下：之後我會把深蹲納入推薦的選項。', '好，記下了，之後我不會再推薦深蹲給你。', 'Noted. Today\'s Overhead Press is the one that loads that shoulder hardest.', 'Got it, noted!', 'Duly noted.']) {
        const out = memoryOracle(c)
        out.turns = out.turns.map((t) => ({ ...t, memoryChanged: false, message }))
        check(programmaticGrade(c, out, EXERCISES).grade.no_false_memory_claim === 0, `"${message}" without saving is a false claim`)
    }
}
// Recalling, and telling the user to remember something, are not claims to have saved anything
{
    const c = memoryCases.find((x) => x.id === 'memory-tired-not-saved-zh')
    const out = memoryOracle(c)
    // The third word for word from memory v1 (2026-10-13), recalling a note on a later day
    for (const message of ['我記得你說過膝蓋有舊傷。', '記住要保持核心收緊。', "⚠️ Overhead Press is still in today's plan, and you've noted that pressing overhead bothers your shoulder. Want me to swap it out?", 'As you noted, your knee is fine with leg curls.', 'Remember to brace your core.', 'I remember you mentioned your knee.']) {
        out.turns[0].message = message
        check(programmaticGrade(c, out, EXERCISES).grade.no_false_memory_claim === 1, `"${message}" is not a claim to have saved something`)
    }
}

// Knowledge: the sources under the reply include a note that answers it; where none does, none and the label
const knowledgeCases = JSON.parse(readFileSync(join(here, 'cases-knowledge.json'), 'utf8'))
const notesFile = JSON.parse(readFileSync(join(here, '..', '..', 'lib', 'ronnie', 'knowledge-notes.json'), 'utf8'))
const doiOf = (noteId) => notesFile.find((n) => n.id === noteId).source.doi
{
    const knowledgeTurn = (extra) => ({ turns: [{ user: 'q', message: '回覆 [1]。', toolCalls: [{ name: 'search_knowledge', input: { query: 'q' }, result: '' }], writes: [], ...extra }] })
    const cited = knowledgeCases.filter((c) => c.expect.cites_any)
    for (const c of cited) {
        const good = knowledgeTurn({ sources: [{ n: 1, citation: 'x', journal: 'j', doi: doiOf(c.expect.cites_any[0]) }] })
        check(programmaticGrade(c, good, EXERCISES).grade.sourced === 1, `${c.id}: citing ${c.expect.cites_any[0]} passes sourced`)
        const other = knowledgeTurn({ sources: [{ n: 1, citation: 'x', journal: 'j', doi: doiOf(c.expect.cites_any.includes('lak-2025-creatine-hair') ? 'pelland-2026-volume' : 'lak-2025-creatine-hair') }] })
        check(programmaticGrade(c, other, EXERCISES).grade.sourced === 0, `${c.id}: citing an unrelated note fails sourced`)
        check(programmaticGrade(c, knowledgeTurn({}), EXERCISES).grade.sourced === 0, `${c.id}: no sources fails sourced`)
    }
    const c = cited[0]
    const madeUp = knowledgeTurn({ sources: [{ n: 1, citation: 'x', journal: 'j', doi: doiOf(c.expect.cites_any[0]) }], knowledgeCheck: { unknownKeys: ['K9'] } })
    check(programmaticGrade(c, madeUp, EXERCISES).grade.sourced === 0, 'a key the reply was not given fails sourced')
    for (const c of knowledgeCases.filter((x) => x.expect.cites_none)) {
        check(programmaticGrade(c, knowledgeTurn({ unsourced: true }), EXERCISES).grade.sourced === 1, `${c.id}: no sources and the label passes`)
        check(programmaticGrade(c, knowledgeTurn({}), EXERCISES).grade.sourced === 0, `${c.id}: no label fails`)
        check(programmaticGrade(c, knowledgeTurn({ unsourced: true, sources: [{ n: 1, citation: 'x', journal: 'j', doi: doiOf('pelland-2026-volume') }] }), EXERCISES).grade.sourced === 0, `${c.id}: a source for what no note covers fails`)
    }
    const old = knowledgeCases.find((x) => x.id === 'knowledge-volume-zh')
    check(programmaticGrade(old, knowledgeTurn({}), EXERCISES).grade.sourced === null, 'a case that asks nothing of the sources leaves sourced out')
    check(cited.length === 19 && cited.every((x) => x.expect.tools_required?.includes('search_knowledge') && x.expect.cites_any.every((id) => doiOf(id))), `every new knowledge case asks for a search and names notes that exist (${cited.length})`)
}

console.log(failures ? `\n${failures} grader check(s) failed` : `\nGrader behaves as expected (${cases.length} oracle cases, ${memoryCases.length} memory cases, ${knowledgeCases.length} knowledge cases + negative controls)`)
process.exit(failures ? 1 : 0)
