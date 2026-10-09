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

console.log(failures ? `\n${failures} check(s) failed` : '\nRonnie tools behave as expected')
process.exit(failures ? 1 : 0)
