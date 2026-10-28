#!/usr/bin/env node
// Free check of how the report reads the user's goal and measures it (lib/report/goal-reader.ts, the goal
// part of facts.ts): no model, no database. The reader's answer keeps only what checks out (an
// exercise from the list, a number in range) and is converted to kg; a text is read once and the
// read reused while it is the same; a read that fails leaves the report without it. A goal lift is
// measured by its estimated 1RM from sets of 10 reps or fewer, a trend shows only from 3 windows,
// a first pull-up by the pulldown or assisted version against body weight, and a body-weight goal
// by its rate a week.
//   node lambda/ai-worker/evals/worker/check-goal.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/worker/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/worker/dist/worker.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const w = createRequire(import.meta.url)(join(here, 'dist', 'worker.cjs'))

let failed = 0
const check = (name, ok, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const near = (a, b, d = 0.051) => a != null && Math.abs(a - b) <= d

const ex = (id, name, nameZh, primary, logType = 'weight_reps', secondary = []) => ({ id, name, nameZh, muscleGroup: 'x', primaryMuscles: primary, secondaryMuscles: secondary, logType })
const BENCH = ex('ex-bench', 'Barbell Bench Press', '槓鈴臥推', ['chest'], 'weight_reps', ['triceps', 'front_delts'])
const SQUAT = ex('ex-squat', 'Barbell Back Squat', '槓鈴深蹲', ['quads', 'glutes'])
const PULLDOWN = ex('ex-pulldown', 'Lat Pulldown', '滑輪下拉', ['lats'], 'weight_reps', ['biceps'])
const RAISE = ex('ex-raise', 'Lateral Raise', '側平舉', ['side_delts'])
const PULLUP = ex('ex-pullup', 'Pull-up', '引體向上', ['lats'], 'bodyweight')
const ASSISTED = ex('ex-assisted', 'Assisted Pull-up', '輔助引體向上', ['lats'], 'assisted')
const LIBRARY = [BENCH, SQUAT, PULLDOWN, RAISE, PULLUP, ASSISTED, ex('ex-front', 'Front Squat', '前蹲', ['quads'])]

// ---------- The reader's answer, checked ----------

{
    const { byKey, lines } = w.exerciseKeys([BENCH, SQUAT, PULLDOWN], LIBRARY)
    const key = (id) => [...byKey].find(([, e]) => e.id === id)[0]
    check('the user\'s own exercises come first and are marked; the library follows without repeats', lines[0].startsWith('x1: Barbell Bench Press') && lines[0].endsWith('(logs)') && lines.length === LIBRARY.length && !lines.at(-1).includes('(logs)'), lines.join(' | '))

    const read = w.checkedRead('希望可以增加整體力量，深蹲160公斤，臥推70公斤，自重引體', {
        kinds: ['strength', 'strength', 'flying'],
        targets: [
            { kind: 'lift', text: '深蹲160公斤', exercise: key('ex-squat'), load: 160, unit: 'kg' },
            { kind: 'lift', text: '臥推70公斤', exercise: key('ex-bench'), load: 70, unit: 'kg' },
            { kind: 'lift', text: '自重引體', exercise: key('ex-pullup'), reps: 1 },
            { kind: 'lift', text: '深蹲 again', exercise: key('ex-squat'), load: 150, unit: 'kg' },
        ],
        unread: null,
    }, byKey, 'lb', 'm')
    check("the owner's goal reads as strength: squat 160 kg, bench 70 kg, a first pull-up", read.kinds.join() === 'strength'
        && read.targets.map((t) => `${t.exerciseId}:${t.loadKg ?? '-'}:${t.reps ?? '-'}:${t.unit ?? '-'}`).join() === 'ex-squat:160:-:kg,ex-bench:70:-:kg,ex-pullup:-:1:-', JSON.stringify(read))
    check('a kind outside the list and a second target for the same lift are dropped', !read.kinds.includes('flying') && read.targets.length === 3)

    const lb = w.checkedRead('bench 225, weigh 180 lb', {
        kinds: ['strength', 'fat_loss'],
        targets: [
            { kind: 'lift', text: 'bench 225', exercise: key('ex-bench'), load: 225, unit: null },
            { kind: 'body_weight', text: 'weigh 180 lb', weight: 180, unit: 'lb' },
        ],
        unread: null,
    }, byKey, 'lb', 'm')
    check('a number with no unit is in the user\'s unit, converted to kg, and shown in it', near(lb.targets[0].loadKg, 102.1) && lb.targets[0].unit === 'lb' && near(lb.targets[1].weightKg, 81.6) && lb.targets[1].unit === 'lb', JSON.stringify(lb.targets))

    const bad = w.checkedRead('x', {
        kinds: [],
        targets: [
            { kind: 'lift', text: 'a', exercise: 'x999', load: 100, unit: 'kg' },
            { kind: 'lift', text: 'b', exercise: key('ex-squat'), load: 9000, unit: 'kg' },
            { kind: 'lift', text: 'c', exercise: key('ex-bench'), reps: 2.5 },
            { kind: 'body_weight', text: 'd', weight: 5, unit: 'kg' },
            { kind: 'body_fat', text: 'e', body_fat: 95 },
            { kind: 'focus', text: 'f', muscles: ['wings'] },
            { kind: 'lift', text: 'g', exercise: key('ex-pulldown') },
        ],
        unread: '  跑完一場半馬  ',
    }, byKey, 'kg', 'm')
    check('an exercise not in the list, a number out of range or not whole, and a muscle that isn\'t a unit are dropped', bad.targets.length === 1 && bad.targets[0].exerciseId === 'ex-pulldown', JSON.stringify(bad.targets))
    check('a lift named with no number is kept, to track', bad.targets[0].loadKg == null && bad.targets[0].reps == null)
    check('what fits no target is kept, trimmed, as written', bad.unread === '跑完一場半馬')

    const physique = w.checkedRead('體態管理，肩膀寬一點，體脂 15%，減到 75 公斤', {
        kinds: ['physique', 'fat_loss'],
        targets: [
            { kind: 'focus', text: '肩膀寬一點', muscles: ['side_delts', 'side_delts'] },
            { kind: 'body_fat', text: '體脂 15%', body_fat: 15 },
            { kind: 'body_weight', text: '減到 75 公斤', weight: 75, unit: 'kg' },
        ],
        unread: null,
    }, byKey, 'lb', 'm')
    check('a physique goal keeps its body parts, body fat and weight', physique.targets.map((t) => t.kind).join() === 'focus,body_fat,body_weight' && physique.targets[0].units.join() === 'side_delts' && physique.targets[2].weightKg === 75 && physique.targets[2].unit === 'kg', JSON.stringify(physique.targets))

    // The model sometimes gives the unit in the goal's own words: it is counted and shown in that unit
    const words = w.checkedRead('減到 75 公斤，臥推 100 公斤，squat 300 lbs', {
        kinds: ['fat_loss', 'strength'],
        targets: [
            { kind: 'body_weight', text: '減到 75 公斤', weight: 75, unit: '公斤' },
            { kind: 'lift', text: '臥推 100 公斤', exercise: key('ex-bench'), load: 100, unit: ' KG ' },
            { kind: 'lift', text: 'squat 300 lbs', exercise: key('ex-squat'), load: 300, unit: 'lbs' },
            { kind: 'lift', text: 'pulldown 50', exercise: key('ex-pulldown'), load: 50, unit: 'stone' },
        ],
        unread: null,
    }, byKey, 'lb', 'm')
    check('a unit in words (公斤, KG, lbs) is that unit, and one it doesn\'t know is the user\'s', words.targets.map((t) => `${t.weightKg ?? t.loadKg}${t.unit}`).join() === '75kg,100kg,136.1lb,22.7lb', JSON.stringify(words.targets))
}

// ---------- The read kept with the goal ----------

{
    const kept = { text: '深蹲 140 kg', kinds: ['strength'], targets: [], unread: null, model: 'm' }
    check('a kept read is used for the text it read, trimmed', w.keptRead(kept, '  深蹲 140 kg\n') === kept)
    check('a kept read of another text, one not read (model null), no goal, or a malformed one is not used',
        w.keptRead(kept, '深蹲 150 kg') === null && w.keptRead({ ...kept, model: null }, '深蹲 140 kg') === null && w.keptRead(kept, '  ') === null
        && w.keptRead(null, '深蹲 140 kg') === null && w.keptRead('深蹲 140 kg', '深蹲 140 kg') === null && w.keptRead({ text: '深蹲 140 kg', model: 'm' }, '深蹲 140 kg') === null)
}

// ---------- Reading once per text ----------

function fakeClient(answer) {
    const calls = []
    return {
        calls,
        messages: {
            create: async (params) => {
                calls.push(params)
                if (answer instanceof Error) throw answer
                return { model: w.GOAL_READER_MODEL, stop_reason: 'tool_use', usage: { input_tokens: 900, output_tokens: 80 }, content: answer ? [{ type: 'tool_use', name: 'submit_goal', input: answer }] : [{ type: 'text', text: 'no' }] }
            },
        },
    }
}
const opts = { own: [BENCH], library: LIBRARY, weightUnit: 'kg', previous: null }

{
    const none = fakeClient({ kinds: [], targets: [], unread: null })
    const empty = await w.readGoal(none, '   ', opts)
    check('no goal: nothing read, no call', empty.read === null && empty.call === null && none.calls.length === 0)

    const previous = { text: '臥推 70 公斤', kinds: ['strength'], targets: [], unread: null, model: 'm' }
    const same = fakeClient({ kinds: [], targets: [], unread: null })
    const reused = await w.readGoal(same, ' 臥推 70 公斤 ', { ...opts, previous })
    check('the same text reuses the last report\'s read, with no call', reused.read === previous && reused.call === null && same.calls.length === 0)

    const changed = fakeClient({ kinds: ['strength'], targets: [], unread: null })
    const fresh = await w.readGoal(changed, '臥推 80 公斤', { ...opts, previous })
    const prompt = changed.calls[0]?.messages[0].content ?? ''
    check('a changed text is read again, with the goal, the unit and the marked list', changed.calls.length === 1 && fresh.read.text === '臥推 80 公斤' && fresh.call.prompt === prompt
        && prompt.includes('<goal>\n臥推 80 公斤\n</goal>') && prompt.includes('logs weights in kg') && prompt.includes('Barbell Bench Press / 槓鈴臥推 (logs)') && changed.calls[0].tool_choice?.name === 'submit_goal', prompt.slice(0, 300))

    const unread = fakeClient({ kinds: [], targets: [], unread: null })
    await w.readGoal(unread, '臥推 70 公斤', { ...opts, previous: { ...previous, model: null } })
    check('a text the last report couldn\'t read is read again', unread.calls.length === 1)

    for (const [name, client] of [['an API error', fakeClient(new Error('overloaded'))], ['an answer without the tool', fakeClient(null)]]) {
        const r = await w.readGoal(client, '深蹲 160', opts)
        check(`${name} leaves the goal unread (model null) and says why, for the trace`, r.read.model === null && r.read.text === '深蹲 160' && r.read.targets.length === 0 && r.call?.error, JSON.stringify(r))
    }
}

// ---------- How far the goal is ----------

const set = (exerciseId, date, weightKg, reps, extra = {}) => ({ date, workoutId: `w-${date}`, exerciseId, reps, weightKg, durationS: null, speedKmh: null, distanceM: null, assistKg: null, loggedAt: `${date}T18:00:00Z`, ...extra })
const base = (overrides) => ({
    periodStart: '2026-10-12', periodEnd: '2026-10-18', sets: [], exercises: [BENCH, SQUAT, PULLDOWN, RAISE, PULLUP, ASSISTED], schedule: null,
    weighIns: [], goal: 'g', routineLeads: [], previousFindings: null, notes: [], ...overrides,
})
function lift(exerciseId, name, extra) {
    return { kind: 'lift', text: name, exerciseId, name, nameZh: null, ...extra }
}

{
    // The owner's 12-18 Oct: bench 42.64x8 this week, 40.82x3 the week before; a light 20-rep set
    // would estimate higher, and doesn't count; squat 65x8; pulldown 50x6; weighed 81.4 and 81.7
    const inputs = base({
        sets: [
            set('ex-bench', '2026-10-12', 42.64, 8), set('ex-bench', '2026-10-12', 35, 20), set('ex-bench', '2026-10-05', 40.82, 3),
            set('ex-squat', '2026-10-14', 65, 8),
            set('ex-pulldown', '2026-10-13', 50, 6),
        ],
        weighIns: [{ date: '2026-10-13', weightKg: 81.4 }, { date: '2026-10-17', weightKg: 81.7 }],
        goalRead: {
            text: 'g', kinds: ['strength'], unread: null, model: 'm',
            targets: [lift('ex-squat', 'Barbell Back Squat', { loadKg: 160, unit: 'kg' }), lift('ex-bench', 'Barbell Bench Press', { loadKg: 70, unit: 'kg' }), lift('ex-pullup', 'Pull-up', { reps: 1 })],
        },
    })
    const facts = w.computeFacts(inputs)
    const [squat, bench, pullUp] = facts.goal.progress
    check('bench: estimated 1RM 54 kg from the 8-rep set, 77% of 70 kg; the 20-rep set doesn\'t count', near(bench.e1rmKg, 54) && bench.share === 0.77, JSON.stringify(bench))
    check('bench: two weeks of logs show no trend yet', bench.change === null && bench.days === 1)
    check('squat: 82.3 kg, 51% of 160', near(squat.e1rmKg, 82.3) && squat.share === 0.51, JSON.stringify(squat))
    check('a first pull-up, not logged yet: the pulldown\'s 60 kg is 73% of 81.7 kg body weight, against a checkpoint of 65.4 kg (80%)', pullUp.bestReps === null && pullUp.proxy?.exerciseId === 'ex-pulldown' && near(pullUp.proxy.e1rmKg, 60) && pullUp.proxy.bodyWeightShare === 0.73 && pullUp.proxy.checkpointKg === 65.4 && pullUp.assisted === null, JSON.stringify(pullUp))
    check('a lift the goal targets leads the main lifts', facts.lifts.filter((l) => l.goalLift).map((l) => l.exerciseId).sort().join() === 'ex-bench,ex-squat')

    const noWeight = w.computeFacts({ ...inputs, weighIns: [] }).goal.progress[2]
    check('without a weigh-in the pulldown has no share of body weight and no checkpoint', noWeight.proxy && noWeight.proxy.bodyWeightShare === null && noWeight.proxy.checkpointKg === null)

    const assisted = w.computeFacts({ ...inputs, sets: [...inputs.sets, set('ex-assisted', '2026-10-13', 0, 8, { assistKg: 25 }), set('ex-assisted', '2026-10-13', 0, 6, { assistKg: 20 })] }).goal.progress[2]
    check('assisted pull-ups: the least assist (20 kg x 6), lifting 76% of body weight', assisted.assisted?.assistKg === 20 && assisted.assisted.reps === 6 && assisted.assisted.bodyWeightShare === 0.76, JSON.stringify(assisted.assisted))

    const done = w.computeFacts({ ...inputs, sets: [...inputs.sets, set('ex-pullup', '2026-10-16', 0, 2)] }).goal.progress[2]
    check('pull-ups logged: the most reps this week', done.bestReps === 2)

    // Bench two more weeks back, 37.5x9 (48.8) and 37.5x10 (50): four windows from 48.8 to 54
    const trend = w.computeFacts({ ...inputs, sets: [...inputs.sets, set('ex-bench', '2026-09-28', 37.5, 10), set('ex-bench', '2026-09-21', 37.5, 9)] }).goal.progress[1]
    check('from 3 windows with a set, the change shows: +5.2 kg over 3 weeks', near(trend.change, 5.2) && trend.changeWindows === 3 && trend.series.join() === ',,48.8,50,44.9,54', JSON.stringify({ series: trend.series, change: trend.change, windows: trend.changeWindows }))

    const skipped = w.computeFacts({ ...inputs, sets: inputs.sets.filter((s) => !(s.exerciseId === 'ex-squat')).concat(set('ex-squat', '2026-10-07', 65, 8)) }).goal.progress[0]
    check('a goal lift not trained this week: 0 days, and the last estimate stands', skipped.days === 0 && near(skipped.e1rmKg, 82.3))
}

{
    // 84, 83, 82.5 and 82 kg over four weeks: -2 kg in 3 weeks, -0.79% a week
    const weighIns = [['2026-09-23', 84], ['2026-09-30', 83], ['2026-10-07', 82.5], ['2026-10-14', 82]].map(([date, weightKg]) => ({ date, weightKg }))
    const facts = w.computeFacts(base({
        sets: [set('ex-raise', '2026-10-12', 8, 12), set('ex-raise', '2026-10-12', 8, 12), set('ex-raise', '2026-10-15', 8, 12)],
        weighIns,
        bodyFat: [{ date: '2026-10-01', pct: 19 }, { date: '2026-10-15', pct: 18.2 }],
        goalRead: {
            text: 'g', kinds: ['physique', 'fat_loss'], unread: null, model: 'm',
            targets: [{ kind: 'body_weight', text: '75', weightKg: 75, unit: 'kg' }, { kind: 'body_fat', text: '15%', bodyFatPct: 15 }, { kind: 'focus', text: 'shoulders', units: ['side_delts', 'rear_delts'] }],
        },
    }))
    const [bw, fat, focus] = facts.goal.progress
    check('body weight: 82 kg now, -2 kg over 3 weeks, -0.79% a week', bw.latestKg === 82 && bw.change === -2 && bw.changeWindows === 3 && near(bw.ratePerWeek, -0.79, 0.011), JSON.stringify(bw))
    check('body fat: the latest, with no trend from two windows', fat.latestPct === 18.2 && fat.change === null, JSON.stringify(fat))
    check('focus: the weekly sets of each part the goal names, 0 for one not trained', focus.muscles.map((m) => `${m.group}:${m.perWeek}`).join() === 'side_delts:3,rear_delts:0', JSON.stringify(focus.muscles))
}

{
    const old = w.computeFacts(base({ sets: [set('ex-bench', '2026-10-12', 42.64, 8)] }))
    check('where the goal isn\'t read (evals, older code) the facts are as before', !('read' in old.goal) && !('progress' in old.goal))
    const none = w.computeFacts(base({ sets: [set('ex-bench', '2026-10-12', 42.64, 8)], goal: null, goalRead: null }))
    check('no goal: read null, nothing to measure', none.goal.read === null && none.goal.progress.length === 0)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
