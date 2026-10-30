import { setWeights } from '../../../../lib/report/volume'
import { readBefore } from '../../../../lib/report/goal-reader'
import { computeFacts, liftFor } from './facts'
import { withExerciseOptions } from './options'
import { withPlan } from './plan'
import { evaluateRules, followUp } from './rules'
import type { DayFacts, DayNote, GoalRead, ReportInputs, ReportStats } from './types'

/**
 * A week below the sets advice needs: its numbers alone, with no rules and no model call. The
 * goal shows as read before while its text is the same; a text not read yet waits for a report
 * with advice, or Settings, to read it.
 */
export function statsOf(inputs: ReportInputs, previousGoal: GoalRead | null): ReportStats {
    return { version: 3, statsOnly: true, facts: computeFacts({ ...inputs, goalRead: readBefore(inputs.goal, previousGoal) }) }
}

/** Everything in the report that code decides: the facts, the rules that fired (with the exercises to suggest), last report's follow-up, and the day notes lined up with the days. */
export function analyze(inputs: ReportInputs) {
    const facts = computeFacts(inputs)
    // The units each exercise mainly trains, for the volume a stalled goal lift calls for
    const primaryUnitsOf = (id: string) => {
        const e = inputs.exercises.find((x) => x.id === id)
        return e ? setWeights(e.primaryMuscles, e.secondaryMuscles, e.muscleGroup).filter(([, w]) => w === 1).map(([u]) => u) : []
    }
    const { findings: fired, watching } = evaluateRules(facts, primaryUnitsOf, inputs.previousFindings)
    // A low muscle's advice offers two ways to add its sets, both chosen here from the user's exercises and the library;
    // then what to do next session on each main lift (plan.ts)
    const findings = withPlan(withExerciseOptions(fired, inputs), facts, inputs)
    const followUps = followUp(inputs.previousFindings, facts, (id) => liftFor(inputs, id))
    const dayNotes = alignDayNotes(facts.sessions.days, inputs.notes)
    return { facts, findings, watching, followUps, dayNotes }
}

/** Each note with its day's planned routine and whether the user trained, so the model never has to work out which day was which. */
export function alignDayNotes(days: DayFacts[], notes: ReportInputs['notes']): DayNote[] {
    const noteOn = new Map(notes.map((n) => [n.date, n.note]))
    return days.filter((d) => noteOn.has(d.date)).map((d) => ({ ...d, note: noteOn.get(d.date)! }))
}
