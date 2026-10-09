import { computeFacts, liftFor } from './facts'
import { withExerciseOptions } from './options'
import { evaluateRules, followUp } from './rules'
import type { DayFacts, DayNote, ReportInputs } from './types'

/** Everything in the report that code decides: the facts, the rules that fired (with the exercises to suggest), last report's follow-up, and the day notes lined up with the days. */
export function analyze(inputs: ReportInputs) {
    const facts = computeFacts(inputs)
    const { findings: fired, watching } = evaluateRules(facts)
    // A low muscle's advice offers two ways to add its sets, both chosen here from the user's exercises and the library
    const findings = withExerciseOptions(fired, inputs)
    const followUps = followUp(inputs.previousFindings, facts, (id) => liftFor(inputs, id))
    const dayNotes = alignDayNotes(facts.sessions.days, inputs.notes)
    return { facts, findings, watching, followUps, dayNotes }
}

/** Each note with its day's planned routine and whether the user trained, so the model never has to work out which day was which. */
export function alignDayNotes(days: DayFacts[], notes: ReportInputs['notes']): DayNote[] {
    const noteOn = new Map(notes.map((n) => [n.date, n.note]))
    return days.filter((d) => noteOn.has(d.date)).map((d) => ({ ...d, note: noteOn.get(d.date)! }))
}
