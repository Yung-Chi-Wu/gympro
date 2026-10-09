import { setWeights, SUGGESTED_EXERCISES, type VolumeUnit } from '../../../../lib/report/volume'
import { windowOfFor } from './facts'
import type { ExerciseInfo, Finding, ReportInputs } from './types'

// Two ways to add a low muscle's sets, for the user to choose between: more sets of an exercise
// they already do, or a new exercise from a short list of staples (lib/report/volume.ts). Code
// picks both, so the advice names only exercises the user has or can find in the library.

/** Periods back, this one included, that make an exercise one the user does */
const RECENT_WINDOWS = 4
/** More sets than this of an exercise that only trains the muscle on the side isn't a real option */
const MAX_HALF_SETS = 6
/** A new exercise gets at least this many sets: one set of it isn't worth learning it */
const MIN_NEW_SETS = 2

export function withExerciseOptions(findings: Finding[], inputs: ReportInputs): Finding[] {
    if (!findings.some((f) => f.rule === 'low_volume')) return findings
    const windowOf = windowOfFor(inputs.periodStart, inputs.periodEnd)
    const byId = new Map(inputs.exercises.map((e) => [e.id, e]))

    // The user's exercises, most done first: sets this period, then recent sets, then planned sets
    const done = new Map<string, [now: number, recent: number, planned: number]>()
    const bump = (id: string, i: 0 | 1 | 2, n: number) => {
        if (!byId.has(id)) return
        const c = done.get(id) ?? [0, 0, 0]
        c[i] += n
        done.set(id, c)
    }
    for (const s of inputs.sets) {
        const k = windowOf(s.date)
        if (k === 0) bump(s.exerciseId, 0, 1)
        if (k >= 0 && k < RECENT_WINDOWS) bump(s.exerciseId, 1, 1)
    }
    for (const d of inputs.schedule ?? []) for (const p of d.plan) bump(p.exerciseId, 2, p.sets)
    const mine = [...done.entries()]
        .sort(([a, x], [b, y]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || byId.get(a)!.name.localeCompare(byId.get(b)!.name))
        .map(([id]) => byId.get(id)!)
    const mineNames = new Set(mine.map((e) => e.name))
    const weightFor = (e: ExerciseInfo, unit: string) => setWeights(e.primaryMuscles, e.secondaryMuscles, e.muscleGroup).find(([u]) => u === unit)?.[1] ?? 0

    return findings.map((f) => {
        if (f.rule !== 'low_volume' || !f.subject) return f
        const unit = f.subject
        const addSets = Number(f.data.addSets)
        // An exercise that mainly trains the muscle; failing that, one that trains it on the side,
        // where each set counts half, so it takes twice the sets, while that stays reasonable
        const addTo = mine.find((e) => weightFor(e, unit) === 1)
            ?? (addSets * 2 <= MAX_HALF_SETS ? mine.find((e) => weightFor(e, unit) === 0.5) : undefined) ?? null
        const half = addTo != null && weightFor(addTo, unit) === 0.5
        const staple = (SUGGESTED_EXERCISES[unit as VolumeUnit] ?? [])
            .map((name) => inputs.exercises.find((e) => e.name === name))
            .find((e): e is ExerciseInfo => !!e && !mineNames.has(e.name) && weightFor(e, unit) === 1) ?? null
        return {
            ...f,
            data: {
                ...f.data,
                addTo: addTo?.name ?? null,
                addToZh: addTo ? addTo.nameZh ?? addTo.name : null,
                addToId: addTo?.id ?? null,
                addToSets: addTo ? (half ? addSets * 2 : addSets) : null,
                addToHalf: addTo ? Number(half) : null,
                newExercise: staple?.name ?? null,
                newExerciseZh: staple ? staple.nameZh ?? staple.name : null,
                newExerciseId: staple?.id ?? null,
                newExerciseSets: staple ? Math.max(addSets, MIN_NEW_SETS) : null,
            },
        }
    })
}
