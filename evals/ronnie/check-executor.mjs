#!/usr/bin/env node
// Offline checks of Ronnie's tools against the fixture - no API calls.
//   npm run eval:ronnie:build && node evals/ronnie/check-executor.mjs

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { EXERCISES, FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_USER, createFixtureData, createRonnieExecutor } = createRequire(import.meta.url)(join(here, 'dist', 'ronnie.cjs'))

let failures = 0
const check = (cond, msg) => { if (!cond) { failures++; console.log(`FAIL ${msg}`) } else console.log(`ok   ${msg}`) }
const id = (name) => EXERCISES.find((e) => e.name === name).id
const executorFor = (data, weightUnit = 'kg') => createRonnieExecutor({
    data, language: 'zh-TW', timeZone: FIXTURE_TIME_ZONE, todayRoutineName: FIXTURE_USER.todayRoutineName, weightUnit, now: () => FIXTURE_NOW,
})

// Two removals in one turn run in parallel. Each looking up (and, with no workout yet, creating)
// today's workout made two workouts on 2026-10-09, and later changes went to the one not shown.
{
    const { data } = createFixtureData()
    let lookups = 0
    const slow = { ...data, ensureTodayWorkout: async () => { lookups++; await new Promise((r) => setTimeout(r, 20)); return data.ensureTodayWorkout() } }
    const executor = executorFor(slow)
    const results = await Promise.all([
        executor.executeTool('remove_exercise_today', { exercise_id: id('Overhead Press') }),
        executor.executeTool('remove_exercise_today', { exercise_id: id('Triceps Pushdown') }),
    ])
    check(lookups === 1, `parallel removals look up today's workout once (looked up ${lookups} times)`)
    check(results.every((r) => r.startsWith('✓') && !r.includes('undefined')), `both removals succeed and name the exercise (${results.map((r) => r.slice(0, 30)).join(' | ')})`)
}

// Sets are stored in kg; a lb user's tool results give lb, so Ronnie answers in lb
{
    const { data } = createFixtureData()
    const today = FIXTURE_NOW.toISOString().slice(0, 10)
    const lb = await executorFor(data, 'lb').executeTool('get_workout_history', { date_from: today, date_to: today })
    check(/×181\.9lb/.test(lb) && !/kg/.test(lb), `a lb user's history is in lb: ${lb.split('\n').find((l) => l.includes('×')) ?? lb.slice(0, 80)}`)
    const kg = await executorFor(data, 'kg').executeTool('get_workout_history', { date_from: today, date_to: today })
    check(/×82\.5kg/.test(kg), `a kg user's history stays in kg: ${kg.split('\n').find((l) => l.includes('×')) ?? kg.slice(0, 80)}`)
    const summary = await executorFor(data, 'lb').executeTool('get_training_summary', { date_from: today, date_to: today })
    check(!/\bkg\b/.test(summary), `a lb user's summary has no kg: ${summary.split('\n')[0]}`)
}

// Cardio, timed and assisted sets keep their values outside reps and weight_kg. Read as reps x
// weight, a treadmill set was "0 reps (bodyweight)" (2026-10-12); each reads the way it is logged.
{
    const { data } = createFixtureData()
    const todayId = await data.ensureTodayWorkout()
    const blank = { reps: 0, weightKg: 0, durationS: null, speedKmh: null, inclinePct: null, level: null, distanceM: null, assistKg: null, inputUnit: null }
    const exercise = (n, name, zh, group, logType) => ({
        id: `00000000-0000-4000-8000-00000000000${n}`, name, name_zh_tw: zh, muscle_group: group,
        primary_muscles: [], secondary_muscles: [], joint_load: null, log_type: logType,
    })
    const treadmill = exercise(1, 'Treadmill', '跑步機', 'cardio', 'treadmill')
    const rower = exercise(2, 'Rowing Machine', '划船機', 'cardio', 'rower')
    const assisted = exercise(3, 'Assisted Pull-up', '輔助引體向上', 'back', 'assisted')
    const plank = EXERCISES.find((e) => e.name === 'Plank')
    const extraSets = [
        { ...blank, workout_id: todayId, exercise_id: treadmill.id, durationS: 1200, speedKmh: 10, inclinePct: 2 },
        { ...blank, workout_id: todayId, exercise_id: rower.id, durationS: 600, distanceM: 2000 },
        { ...blank, workout_id: todayId, exercise_id: assisted.id, reps: 8, assistKg: 20, inputUnit: 'kg' },
        { ...blank, workout_id: todayId, exercise_id: plank.id, durationS: 45 },
    ]
    const plannedExtra = [treadmill, rower, assisted, plank].map((e) => ({ exercise_id: e.id, exercises: { name: e.name, name_zh_tw: e.name_zh_tw } }))
    const withExtras = (w) => (w && w.id === todayId ? { ...w, workout_planned_exercises: [...w.workout_planned_exercises, ...plannedExtra] } : w)
    const withCardio = {
        ...data,
        listExercises: async () => [...(await data.listExercises()), treadmill, rower, assisted],
        getSets: async (ids) => [...(await data.getSets(ids)), ...extraSets.filter((s) => ids.includes(s.workout_id))],
        getLatestWorkoutBetween: async (a, b) => withExtras(await data.getLatestWorkoutBetween(a, b)),
        getWorkoutsBetween: async (a, b) => (await data.getWorkoutsBetween(a, b)).map(withExtras),
    }
    const metric = createRonnieExecutor({ data: withCardio, language: 'zh-TW', timeZone: FIXTURE_TIME_ZONE, todayRoutineName: FIXTURE_USER.todayRoutineName, now: () => FIXTURE_NOW })
    const imperial = createRonnieExecutor({ data: withCardio, language: 'zh-TW', timeZone: FIXTURE_TIME_ZONE, todayRoutineName: FIXTURE_USER.todayRoutineName, weightUnit: 'lb', distanceUnit: 'mi', now: () => FIXTURE_NOW })

    const today = await metric.executeTool('get_today_workout', {})
    const line = (text, name) => text.split('\n').find((l) => l.includes(name)) ?? '(no line)'
    check(line(today, '跑步機').includes('20 min at 10 km/h, 2% incline'), `a treadmill set reads as minutes, speed and incline: ${line(today, '跑步機')}`)
    check(line(today, '划船機').includes('10 min, 2000 m'), `a rower set reads as minutes and metres: ${line(today, '划船機')}`)
    check(line(today, '輔助引體向上').includes('8 reps, 20kg assist'), `an assisted set says how much assist: ${line(today, '輔助引體向上')}`)
    check(line(today, '棒式').includes('45 s'), `a timed set reads in seconds: ${line(today, '棒式')}`)
    check(!/\b0 reps\b/.test(today), 'no set reads as 0 reps')
    check(line(today, '槓鈴臥推').includes('8×82.5kg'), `a weighted set reads as before: ${line(today, '槓鈴臥推')}`)

    const todayImperial = await imperial.executeTool('get_today_workout', {})
    check(line(todayImperial, '跑步機').includes('6.2 mph'), `a mi user's treadmill speed is in mph: ${line(todayImperial, '跑步機')}`)
    check(line(todayImperial, '輔助引體向上').includes('44.1lb assist'), `a lb user's assist is in lb: ${line(todayImperial, '輔助引體向上')}`)

    const date = FIXTURE_NOW.toISOString().slice(0, 10)
    const summary = await metric.executeTool('get_training_summary', { date_from: date, date_to: date })
    check(/Cardio: 30 min: .*跑步機 20 min, 3\.33 km.*划船機 10 min, 2000 m/.test(summary), `cardio is time and distance in the summary: ${line(summary, 'Cardio')}`)
    check(/1 sessions, 5 sets/.test(summary), `cardio sets aren't counted as strength sets: ${summary.split('\n')[0]}`)
    check(/輔助引體向上 1 sets \(1 sessions\), best 8 reps, 20kg assist/.test(summary), `an assisted lift's best set is its assist: ${line(summary, 'By exercise')}`)
    check(!/cardio \d+ sets/.test(summary), 'cardio is not a muscle group with sets')
}

console.log(failures ? `\n${failures} check(s) failed` : '\nRonnie tools behave as expected')
process.exit(failures ? 1 : 0)
