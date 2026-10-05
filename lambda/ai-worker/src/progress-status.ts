import type { ProgressStatus } from './narrative-schema'
import type { TrainingPeriodSummary } from './types'

// Index changes smaller than this are treated as noise
export const MEANINGFUL_CHANGE = 3

/**
 * Progress status by the agreed rule (2026-10-05). Computed in code rather than
 * left to the model: the weekly-report eval found Sonnet mislabelling it in 5 of
 * 22 cases, the same way on every run.
 *
 * Each muscle group's change is measured against its previous index, or against
 * 100 when there is no previous report (100 = the user's first recorded level).
 */
export function computeProgressStatus(strengthIndex: TrainingPeriodSummary['strengthIndex']): ProgressStatus {
    const deltas = Object.values(strengthIndex).map((s) => s.currentIndex - (s.previousIndex ?? 100))
    if (deltas.length === 0) return 'insufficient_data'
    if (deltas.some((d) => d <= -MEANINGFUL_CHANGE)) return 'regressing'
    if (deltas.some((d) => d >= MEANINGFUL_CHANGE)) return 'on_track'
    return 'stalling'
}
