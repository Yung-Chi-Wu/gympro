import { computeFacts, liftFor } from './facts'
import { evaluateRules, followUp } from './rules'
import type { ReportInputs } from './types'

/** Everything in the report that code decides: the facts, the rules that fired, and last report's follow-up. */
export function analyze(inputs: ReportInputs) {
    const facts = computeFacts(inputs)
    const { findings, watching } = evaluateRules(facts)
    const followUps = followUp(inputs.previousFindings, facts, (id) => liftFor(inputs, id))
    return { facts, findings, watching, followUps }
}
