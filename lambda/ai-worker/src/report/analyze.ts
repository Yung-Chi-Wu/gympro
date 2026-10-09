import { computeFacts, liftFor } from './facts'
import { withExerciseOptions } from './options'
import { evaluateRules, followUp } from './rules'
import type { ReportInputs } from './types'

/** Everything in the report that code decides: the facts, the rules that fired (with the exercises to suggest), and last report's follow-up. */
export function analyze(inputs: ReportInputs) {
    const facts = computeFacts(inputs)
    const { findings: fired, watching } = evaluateRules(facts)
    // A low muscle's advice offers two ways to add its sets, both chosen here from the user's exercises and the library
    const findings = withExerciseOptions(fired, inputs)
    const followUps = followUp(inputs.previousFindings, facts, (id) => liftFor(inputs, id))
    return { facts, findings, watching, followUps }
}
