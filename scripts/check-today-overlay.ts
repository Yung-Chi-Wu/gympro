// Free check of what opens over Today (lib/today-overlay.ts): last week's recap once its report is
// done and the week had training, once per week and never a week late, never in the middle of
// today's workout; and that it holds a number against the week before only when it went up.
//   npm run check:today-overlay
import { dueOverlay } from '../lib/today-overlay'
import type { LatestReport } from '../lib/report/latest'
import type { RecordFacts, ReportFacts } from '../lib/report/types'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}

const WEEK = '2026-10-26'
const DAYS = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
const bench: RecordFacts = { exerciseId: 'bench', name: 'Barbell Bench Press', nameZh: '槓鈴臥推', best: { weightKg: 60, reps: 5 }, bodyweight: false, date: '2026-10-28' }

/** Last week's facts, as much of them as the recap reads; trained: the days of the week with training */
const factsOf = ({ trained = [0, 2, 4], planned = null, previousDone = null, sets = 30, previousSets = null, records = [], cardio = 0 }: {
    trained?: number[]; planned?: number | null; previousDone?: number | null; sets?: number; previousSets?: number | null; records?: RecordFacts[]; cardio?: number
} = {}) => ({
    period: { start: WEEK, end: DAYS[6], days: 7 },
    sessions: { done: trained.length, planned, previousDone, days: DAYS.map((date, i) => ({ date, routine: null, trained: trained.includes(i) })) },
    totalSets: { now: sets, previous: previousSets },
    records,
    cardio: cardio ? { minutes: cardio } : undefined,
}) as unknown as ReportFacts

const report = (facts: ReportFacts | null, status: LatestReport['status'] = 'completed', periodStart = WEEK): LatestReport =>
    ({ status, periodStart, recommendation: facts ? { version: 3, facts } : null }) as unknown as LatestReport

type Input = Parameters<typeof dueOverlay>[0]
const base: Input = { onboarded: true, latest: report(factsOf()), lastPeriod: { start: WEEK }, recapSeenWeek: null, loggedToday: false }
const due = (over: Partial<Input> = {}) => dueOverlay({ ...base, ...over })
const recap = (facts: ReportFacts) => due({ latest: report(facts) })?.recap ?? null

// ---------- When it opens ----------
const first = due()
check('a week with training whose report is done opens its recap', first?.kind === 'recap' && first.recap.trained === 3 && first.recap.start === WEEK && first.recap.end === DAYS[6],
    JSON.stringify(first))
check('the days are the week in order, the trained ones marked',
    JSON.stringify(first?.recap.days.map((d) => d.trained)) === JSON.stringify([true, false, true, false, true, false, false]))
check('a week of a few sets (stats only) opens it too', due({ latest: report(factsOf({ trained: [1], sets: 4 }), 'insufficient_data') })?.recap.trained === 1)
check('not before onboarding is done', due({ onboarded: false }) === null)
check('not once today has a set: the user is in the middle of a workout', due({ loggedToday: true }) === null)
check('not again once this week is seen', due({ recapSeenWeek: WEEK }) === null)
check('the week before seen is no reason not to open this one', due({ recapSeenWeek: '2026-10-19' })?.kind === 'recap')
check("not while the report is being written, or when it failed", due({ latest: report(factsOf(), 'pending') }) === null && due({ latest: report(factsOf(), 'failed') }) === null)
check("not for an older week: a report that isn't ready yet is no recap of the week before it", due({ latest: report(factsOf(), 'completed', '2026-10-19') }) === null)
check('not for a week with nothing logged', due({ latest: report(factsOf({ trained: [], sets: 0 }), 'insufficient_data') }) === null)
check('not without a report, or one without numbers (saved before reports had them)', due({ latest: null }) === null && due({ latest: report(null) }) === null)
check('not before any week has ended', due({ lastPeriod: null }) === null)

// ---------- Only good news is held against the week before ----------
check('every planned day trained says so', JSON.stringify(recap(factsOf({ planned: 3, previousDone: 5 }))?.daysNote) === JSON.stringify({ kind: 'allPlanned', planned: 3 }))
check('more days than the week before says how many more', JSON.stringify(recap(factsOf({ planned: 4, previousDone: 1 }))?.daysNote) === JSON.stringify({ kind: 'more', n: 2 }))
check('fewer or as many days says nothing about them', recap(factsOf({ previousDone: 3 }))?.daysNote === null && recap(factsOf({ previousDone: 5 }))?.daysNote === null)
check('a first week, with none before, says nothing about them', recap(factsOf())?.daysNote === null)
check('a week with no plan (no cycle, or rest days only) is held only against the week before', recap(factsOf({ planned: 0, previousDone: 1 }))?.daysNote?.kind === 'more')
check('more sets says how many more', recap(factsOf({ sets: 30, previousSets: 24 }))?.moreSets === 6)
check('fewer or as many sets, or none to compare, says nothing about them',
    recap(factsOf({ sets: 20, previousSets: 24 }))?.moreSets === null && recap(factsOf({ sets: 24, previousSets: 24 }))?.moreSets === null && recap(factsOf())?.moreSets === null)

// ---------- What it shows ----------
const squat: RecordFacts = { ...bench, exerciseId: 'squat', name: 'Barbell Back Squat', nameZh: '槓鈴深蹲' }
const withBests = recap(factsOf({ records: [bench, squat] }))
check('the new bests: how many, and the first to name', withBests?.records.count === 2 && withBests.records.first?.exerciseId === 'bench')
check('no new bests, none to name', recap(factsOf())?.records.count === 0 && recap(factsOf())?.records.first === null)
const cardioOnly = recap(factsOf({ trained: [1, 3], sets: 0, cardio: 44.6 }))
check('a week of cardio only says its minutes, whole', cardioOnly?.sets === 0 && cardioOnly.cardioMinutes === 45)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
