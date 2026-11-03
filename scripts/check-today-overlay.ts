// Free check of what opens over Today (lib/today-overlay.ts): new medals the day after they are
// reached, checked once a day, before anything else; last week's recap once its report is done and
// the week had training, once per week and never a week late; neither in the middle of today's
// workout; that it holds a number against the week before only when it went up; that it
// says what covers the whole week: every new best counted, every body group trained; and that it
// counts the report's advice as the report shows it.
//   npm run check:today-overlay
import { dueOverlay, medalsToCheck, newMedals } from '../lib/today-overlay'
import type { AwardTrack } from '../lib/awards'
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
const factsOf = ({ trained = [0, 2, 4], planned = null, previousDone = null, sets = 30, records = [], cardio = 0, series, groups }: {
    trained?: number[]; planned?: number | null; previousDone?: number | null; sets?: number; records?: RecordFacts[]; cardio?: number
    series?: (number | null)[]; groups?: [string, number][]
} = {}) => ({
    period: { start: WEEK, end: DAYS[6], days: 7 },
    sessions: { done: trained.length, planned, previousDone, series, days: DAYS.map((date, i) => ({ date, routine: null, trained: trained.includes(i) })) },
    totalSets: { now: sets, previous: null },
    groups: groups?.map(([group, n]) => ({ group, sets: n, previous: null })),
    records,
    cardio: cardio ? { minutes: cardio } : undefined,
}) as unknown as ReportFacts

const report = (facts: ReportFacts | null, status: LatestReport['status'] = 'completed', periodStart = WEEK): LatestReport =>
    ({ status, periodStart, recommendation: facts ? { version: 3, facts } : null }) as unknown as LatestReport

type Input = Parameters<typeof dueOverlay>[0]
const base: Input = { onboarded: true, latest: report(factsOf()), lastPeriod: { start: WEEK }, recapSeenWeek: null, loggedToday: false, medals: null }
const due = (over: Partial<Input> = {}) => dueOverlay({ ...base, ...over })
/** The recap a visit opens, or null when it opens something else or nothing */
const recapIn = (overlay: ReturnType<typeof dueOverlay>) => (overlay?.kind === 'recap' ? overlay.recap : null)
const recap = (facts: ReportFacts) => recapIn(due({ latest: report(facts) }))

// ---------- When it opens ----------
const first = recapIn(due())
check('a week with training whose report is done opens its recap', first?.trained === 3 && first.start === WEEK && first.end === DAYS[6],
    JSON.stringify(first))
check('the days are the week in order, the trained ones marked',
    JSON.stringify(first?.days.map((d) => d.trained)) === JSON.stringify([true, false, true, false, true, false, false]))
check('a week of a few sets (stats only) opens it too', recapIn(due({ latest: report(factsOf({ trained: [1], sets: 4 }), 'insufficient_data') }))?.trained === 1)
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

// ---------- What it shows ----------
const squat: RecordFacts = { ...bench, exerciseId: 'squat', name: 'Barbell Back Squat', nameZh: '槓鈴深蹲' }
const deadlift: RecordFacts = { ...bench, exerciseId: 'deadlift', name: 'Deadlift', nameZh: '硬舉' }
const press: RecordFacts = { ...bench, exerciseId: 'press', name: 'Overhead Press', nameZh: '肩推' }
const withBests = recap(factsOf({ records: [bench, squat, deadlift, press] }))
check('every new best is counted, the first three named in the report\'s order',
    withBests?.records.count === 4 && JSON.stringify(withBests.records.named.map((r) => r.exerciseId)) === JSON.stringify(['bench', 'squat', 'deadlift']))
check('no new bests, none named', recap(factsOf())?.records.count === 0 && recap(factsOf())?.records.named.length === 0)
check('the body groups trained, in the report\'s order, and none untrained',
    JSON.stringify(recap(factsOf({ groups: [['chest', 10], ['back', 0], ['legs', 12], ['core', 3]] }))?.groups) === JSON.stringify(['chest', 'legs', 'core']))
check('a report saved before it kept the groups names none', JSON.stringify(recap(factsOf())?.groups) === '[]')
check('cardio minutes are whole', recap(factsOf({ trained: [1, 3], sets: 0, cardio: 44.6 }))?.cardioMinutes === 45)

// ---------- The days trained of the last weeks ----------
const weeks = recap(factsOf({ series: [null, null, 2, 4, 0, 3] }))?.weeks
check('the weeks of the report, each with its first day and days trained, oldest first, the last being last week',
    JSON.stringify(weeks?.map((w) => w.start)) === JSON.stringify(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', WEEK])
    && JSON.stringify(weeks?.map((w) => w.days)) === JSON.stringify([null, null, 2, 4, 0, 3]), JSON.stringify(weeks))
check('no weeks with only one to show (a first week)', recap(factsOf({ series: [null, null, null, null, null, 3] }))?.weeks === null)
check('no weeks in a report saved before it kept them', recap(factsOf())?.weeks === null)

// ---------- What the report holds for the week ahead ----------
const advised = { version: 3, facts: factsOf(), findings: [{ id: 'low_volume:back', rule: 'low_volume' }, { id: 'low_volume:legs', rule: 'low_volume' }, { id: 'next_session:bench', rule: 'next_session' }],
    narrative: { headline: '', items: [{ rule: 'low_volume', action: '' }, { rule: 'next_session', action: '' }, { rule: 'deload', action: '' }] } }
const withAdvice = recapIn(due({ latest: { status: 'completed', periodStart: WEEK, recommendation: advised } as unknown as LatestReport }))
check("the report's advice is counted as the report shows it: one per rule, none without a finding", withAdvice?.advice === 2, JSON.stringify(withAdvice?.advice))
check('a week of a few sets (stats only) has none', recapIn(due({ latest: report(factsOf({ trained: [1], sets: 4 }), 'insufficient_data') }))?.advice === 0)

// ---------- New medals ----------
const TODAY = '2026-11-03'
const track = (id: AwardTrack['id'], reached: AwardTrack['reached']): AwardTrack => ({ id, tiers: [40, 60, 100], best: 0, reached })
const tracks = [
    track('bench', ['2026-10-20', '2026-11-02', null]),
    track('squat', ['2026-11-02', '2026-11-02', null]),
    track('deadlift', ['2026-11-03', null, null]),
    track('days', ['2026-11-01', null, null]),
]
check('a visit checks for medals once a day: not again once yesterday is checked',
    medalsToCheck({ onboarded: true, awardsSeen: '2026-11-01', today: TODAY }) && !medalsToCheck({ onboarded: true, awardsSeen: '2026-11-02', today: TODAY }))
check('a new account (none checked yet) checks; not before onboarding is done',
    medalsToCheck({ onboarded: true, awardsSeen: null, today: TODAY }) && !medalsToCheck({ onboarded: false, awardsSeen: null, today: TODAY }))
const found = newMedals(tracks, { awardsSeen: '2026-11-01', today: TODAY })
check("the medals reached after the last day checked and before today, the highest of each award, in the awards' order",
    JSON.stringify(found.medals.map((m) => `${m.id}:${m.tier}:${m.mark}`)) === JSON.stringify(['bench:silver:60', 'squat:silver:60']), JSON.stringify(found))
check('each says the next medal of its award, none after gold',
    JSON.stringify(found.medals[0].next) === JSON.stringify({ tier: 'gold', mark: 100 })
    && newMedals([track('bench', ['2026-10-20', '2026-10-21', '2026-11-02'])], { awardsSeen: '2026-11-01', today: TODAY }).medals[0].next === null)
check("today's medal waits for tomorrow, and the check covers up to yesterday", !found.medals.some((m) => m.id === 'deadlift') && found.through === '2026-11-02')
check('a new account has every medal before today as new',
    JSON.stringify(newMedals(tracks, { awardsSeen: null, today: TODAY }).medals.map((m) => m.id)) === JSON.stringify(['bench', 'squat', 'days']))
const medalsDue = { medals: found.medals, through: found.through }
check('new medals open before the recap', due({ medals: medalsDue })?.kind === 'medals')
check('not in the middle of a workout, nor before onboarding is done', due({ medals: medalsDue, loggedToday: true }) === null && due({ medals: medalsDue, onboarded: false }) === null)
check('a check that found none leaves the visit to the recap', due({ medals: { medals: [], through: found.through } })?.kind === 'recap')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
