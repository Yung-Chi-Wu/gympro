// Free check of 課表's calendar (lib/cycle-calendar.ts): which day of the cycle a date is, what
// each day shows, a day given another routine or made a rest day, the month's weeks, each day's
// round (a report's period), what the calendar reads for a month and the wider range 課表 reads it
// in ahead, the next workout after a rest day, the sessions a round plans and the routines' colors. Also that the cycle day is worked out only in lib/periods.ts, and a date's plan
// read only through plannedRoutineId, so the calendar, Today, Ronnie, 紀錄 and the report can't
// count it differently.
//   npm run check:cycle-calendar
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { calendarDay, calendarRange, calendarReadAhead, isCyclesOwn, monthWeeks, nextPlanned, plannedSessions, routineColors, type CalendarCycle } from '../lib/cycle-calendar'
import { addDays, cycleDayOf, plannedRoutineId } from '../lib/periods'
import { monthOf } from '../lib/history'
import { historyDaysOf, type HistoryRows } from '../lib/history-data'
import type { HistoryDay } from '../lib/history'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n       ${detail}`}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Push, pull, legs, push, legs, pull, rest; starting on a Monday
const seven: CalendarCycle = {
    cycleLength: 7,
    startDate: '2026-09-28',
    routineByDay: { 1: 'push', 2: 'pull', 3: 'legs', 4: 'push', 5: 'legs', 6: 'pull', 7: null },
    changes: new Map(),
}
// Upper, lower, rest, full body: rounds that don't line up with weeks
const four: CalendarCycle = { cycleLength: 4, startDate: '2026-10-01', routineByDay: { 1: 'upper', 2: 'lower', 3: null, 4: 'full' }, changes: new Map() }
// The 7-day cycle with tomorrow's push (10/26) and a past pull (10/24) made rest days
const rested: CalendarCycle = { ...seven, changes: new Map([['2026-10-26', null], ['2026-10-24', null]]) }
// And with Wednesday's legs (10/28) given push, and Sunday's rest (11/1) given pull
const swapped: CalendarCycle = { ...seven, changes: new Map([['2026-10-28', 'push'], ['2026-11-01', 'pull']]) }
const today = '2026-10-25'
const trained = (date: string): HistoryDay => ({ date, routineNames: ['Push Day'], exercises: [{ exerciseId: 'e', name: 'Bench', logType: 'weight_reps', sets: [{ weightKg: 80, reps: 8 }] }], note: null } as unknown as HistoryDay)
const noteOnly = (date: string): HistoryDay => ({ date, routineNames: [], exercises: [], note: 'tired' })

// ---------- The cycle's day ----------
check('the start is day 1, and the day before it the last day, counting backwards',
    cycleDayOf(seven, '2026-09-28') === 1 && cycleDayOf(seven, '2026-09-27') === 7 && cycleDayOf(seven, '2026-09-21') === 1)
check('today, four weeks on, is day 7', cycleDayOf(seven, today) === 7)
check('a 4-day cycle comes round every 4 days', cycleDayOf(four, '2026-10-05') === 1 && cycleDayOf(four, today) === 1 && cycleDayOf(four, '2026-10-24') === 4)

// ---------- What a day shows ----------
const status = (cycle: CalendarCycle, date: string, day?: HistoryDay) => calendarDay(date, cycle, today, day).status
check('a planned day before today with sets is done', status(seven, '2026-10-19', trained('2026-10-19')) === 'done')
check('a planned day before today without sets is missed, a note alone too', status(seven, '2026-10-14') === 'missed' && status(seven, '2026-10-14', noteOnly('2026-10-14')) === 'missed')
check("today's planned routine before any set is today's", status(four, today) === 'today')
check('a planned day ahead is planned', status(seven, '2026-10-27') === 'planned')
check('a rest day is rest, ahead or past', status(seven, '2026-11-01') === 'rest' && status(seven, '2026-10-18') === 'rest')
check('training on a rest day still counts as done', status(seven, '2026-10-18', trained('2026-10-18')) === 'done')
{
    const before = calendarDay('2026-09-25', seven, today, undefined)
    check('before the cycle starts a day has no plan, the way a report counts it',
        before.status === 'none' && before.cycleDay === null && before.routineId === null, JSON.stringify(before))
    check('and training then is still shown', status(seven, '2026-09-25', trained('2026-09-25')) === 'done')
}
// ---------- A day changed ----------
{
    const plan = (date: string, changes: Map<string, string | null>) => plannedRoutineId(seven, seven.routineByDay, date, changes)
    check("a date's plan is the cycle's, once the cycle has started", plan('2026-10-26', new Map()) === 'push' && plan('2026-09-27', new Map()) === null)
    check('a date the user changed trains their pick: another routine, a rest day, or a routine on a rest day',
        plan('2026-10-26', new Map([['2026-10-26', 'legs']])) === 'legs' && plan('2026-10-26', new Map([['2026-10-26', null]])) === null
        && plan('2026-11-01', new Map([['2026-11-01', 'pull']])) === 'pull')
    check('a change before the cycle starts plans nothing still', plan('2026-09-27', new Map([['2026-09-27', 'push']])) === null)
}
{
    const ahead = calendarDay('2026-10-26', rested, today, undefined)
    check('a day ahead made a rest day plans nothing, keeps its cycle day and says what the cycle had',
        ahead.status === 'rest' && ahead.routineId === null && ahead.cycleDay === 1 && ahead.changed && ahead.cycleRoutineId === 'push', JSON.stringify(ahead))
    const past = calendarDay('2026-10-24', rested, today, undefined)
    check('a past one is rest, not missed', past.status === 'rest' && past.changed && past.cycleRoutineId === 'pull', JSON.stringify(past))
    check('training on it anyway is done', calendarDay('2026-10-26', rested, today, trained('2026-10-26')).status === 'done')
    const own = calendarDay('2026-10-25', rested, today, undefined)
    check("the cycle's own rest days are not changed and have no routine", !own.changed && own.cycleRoutineId === null, JSON.stringify(own))
    check('the next day of the cycle is planned as before: nothing moves', calendarDay('2026-10-27', rested, today, undefined).routineId === 'pull')
}
{
    const wed = calendarDay('2026-10-28', swapped, today, undefined)
    check('a day given another routine plans it, and says the cycle had another',
        wed.status === 'planned' && wed.routineId === 'push' && wed.changed && wed.cycleRoutineId === 'legs' && wed.cycleDay === 3, JSON.stringify(wed))
    const sun = calendarDay('2026-11-01', swapped, today, undefined)
    check('a rest day given a routine plans it, and says the cycle had none', sun.status === 'planned' && sun.routineId === 'pull' && sun.changed && sun.cycleRoutineId === null, JSON.stringify(sun))
    check('the days around them keep the cycle\'s', calendarDay('2026-10-27', swapped, today, undefined).routineId === 'pull' && calendarDay('2026-10-29', swapped, today, undefined).routineId === 'push')
    check("picking the cycle's own routine, or its rest, gives a day back", isCyclesOwn(swapped, '2026-10-28', 'legs') && isCyclesOwn(swapped, '2026-11-01', null)
        && !isCyclesOwn(swapped, '2026-10-28', 'push') && !isCyclesOwn(swapped, '2026-10-28', null))
}

check("a day carries its cycle day and routine", same(
    (({ cycleDay, routineId }) => ({ cycleDay, routineId }))(calendarDay('2026-10-21', seven, today, undefined)), { cycleDay: 3, routineId: 'legs' }))

// ---------- Weeks, a report's period ----------
check("a day's week is Monday to Sunday with a 7-day cycle", same(calendarDay('2026-10-21', seven, today, undefined).week, { start: '2026-10-19', end: '2026-10-25' }))
check("and with a 4-day cycle, whose rounds cross weeks", same(calendarDay('2026-10-27', four, today, undefined).week, { start: '2026-10-26', end: '2026-11-01' }))

// ---------- The month ----------
{
    const weeks = monthWeeks('2026-10')
    check('October 2026 is five weeks, Monday 9/28 to Sunday 11/1',
        weeks.length === 5 && weeks[0][0] === '2026-09-28' && weeks[4][6] === '2026-11-01' && weeks.every((w) => w.length === 7), JSON.stringify(weeks.map((w) => [w[0], w[6]])))
    const feb = monthWeeks('2027-02')
    check('February 2027, Monday the 1st to Sunday the 28th, is four', feb.length === 4 && feb[0][0] === '2027-02-01' && feb[3][6] === '2027-02-28')
    const aug = monthWeeks('2026-08')
    check('August 2026, Saturday the 1st to Monday the 31st, is six', aug.length === 6 && aug[0][0] === '2026-07-27' && aug[5][6] === '2026-09-06')
}
check("a month is read as its weeks, so each week's report comes too", same(calendarRange('2026-10'), { start: '2026-09-28', end: '2026-11-01' }), JSON.stringify(calendarRange('2026-10')))

// ---------- The month read ahead ----------
{
    // Every UTC day of two years and every zone's today within a day of it: the calendar's range is inside what was read
    const misses: string[] = []
    for (let i = 0; i < 730; i++) {
        const utc = addDays('2026-01-01', i)
        const ahead = calendarReadAhead(utc)
        for (const local of [addDays(utc, -1), utc, addDays(utc, 1)]) {
            const range = calendarRange(monthOf(local))
            if (range.start < ahead.start || range.end > ahead.end) misses.push(`${utc} ${local}: ${JSON.stringify(range)} not in ${JSON.stringify(ahead)}`)
        }
    }
    check("the range read ahead holds the calendar's month for any zone", misses.length === 0, misses.slice(0, 3).join('\n       '))
    const ahead = calendarReadAhead('2026-10-27')
    check("and is that month's weeks, nothing before", same(ahead, { start: '2026-09-28', end: '2026-11-01' }), JSON.stringify(ahead))
    check('on the last day of a month in UTC it takes in the next month too', same(calendarReadAhead('2026-10-31'), { start: '2026-09-28', end: '2026-12-06' }))
}
{
    // Rows read for the wider range, cut to the calendar's: a workout logged late on 10/1 in New
    // York is 10/2 in UTC, and a note on 9/20 is before the range
    const rows: HistoryRows = {
        workouts: [
            { performed_at: '2026-09-20T15:00:00Z', routines: { name: 'Pull Day' }, workout_sets: [{ exercise_id: 'e', set_number: 1, created_at: '2026-09-20T15:00:00Z', reps: 8, weight_kg: 60, exercises: { name: 'Row', name_zh_tw: '划船', log_type: 'weight_reps' } }] },
            { performed_at: '2026-10-02T02:30:00Z', routines: { name: 'Push Day' }, workout_sets: [{ exercise_id: 'b', set_number: 1, created_at: '2026-10-02T02:30:00Z', reps: 8, weight_kg: 80, exercises: { name: 'Bench', name_zh_tw: '臥推', log_type: 'weight_reps' } }] },
        ] as unknown as HistoryRows['workouts'],
        notes: new Map([['2026-09-20', 'early'], ['2026-10-05', 'tired']]),
    }
    const days = historyDaysOf(rows, { range: { start: '2026-09-28', end: '2026-11-01' }, timeZone: 'America/New_York', language: 'zh-TW' })
    check("rows read for the wider range keep only the calendar's days, each on the user's own date",
        same(days.map((d) => [d.date, d.routineNames, d.exercises.map((e) => e.name), d.note]), [['2026-10-01', ['Push Day'], ['臥推'], null], ['2026-10-05', [], [], 'tired']]), JSON.stringify(days))
}

// ---------- The next workout ----------
check("after today's rest day, tomorrow's push", same(nextPlanned(seven, today), { date: '2026-10-26', routineId: 'push' }))
check('after the 4-day cycle\'s rest day, the full-body day', same(nextPlanned(four, '2026-10-27'), { date: '2026-10-28', routineId: 'full' }))
check('a cycle of rest days has none', nextPlanned({ cycleLength: 3, startDate: '2026-10-01', routineByDay: { 1: null, 2: null, 3: null }, changes: new Map() }, today) === null)
check('but one of its days given a routine is the next', same(nextPlanned({ cycleLength: 3, startDate: '2026-10-01', routineByDay: { 1: null, 2: null, 3: null }, changes: new Map([['2026-10-30', 'push']]) }, today), { date: '2026-10-30', routineId: 'push' }))
check("after today's rest day, with tomorrow made one, Tuesday's pull", same(nextPlanned(rested, today), { date: '2026-10-27', routineId: 'pull' }))
{
    // A 2-day cycle, push then rest, with the next two pushes made rest days: the next one is past a whole cycle
    const every: CalendarCycle = { cycleLength: 2, startDate: '2026-10-01', routineByDay: { 1: 'push', 2: null }, changes: new Map([['2026-10-27', null], ['2026-10-29', null]]) }
    check('rest days made in a row are looked past', same(nextPlanned(every, today), { date: '2026-10-31', routineId: 'push' }), JSON.stringify(nextPlanned(every, today)))
}

// ---------- Sessions a round plans ----------
check("a week of the 7-day cycle plans 6, 5 with a day made a rest day, and 7 with its rest day given a routine",
    plannedSessions(seven, { start: '2026-10-19', end: '2026-10-25' }) === 6 && plannedSessions(rested, { start: '2026-10-19', end: '2026-10-25' }) === 5
    && plannedSessions(swapped, { start: '2026-10-26', end: '2026-11-01' }) === 7)
check('a round before the cycle starts plans none, and the first one only from its start',
    plannedSessions(seven, { start: '2026-09-21', end: '2026-09-27' }) === 0 && plannedSessions(four, { start: '2026-09-28', end: '2026-10-03' }) === 2)

// ---------- Colors ----------
{
    const colors = routineColors(seven)
    check('routines take colors in the order the cycle first reaches them', same([...colors], [['push', 0], ['pull', 1], ['legs', 2]]))
    const many = routineColors({ cycleLength: 5, startDate: today, routineByDay: { 1: 'a', 2: 'b', 3: 'a', 4: 'c', 5: 'd' }, changes: new Map() })
    check('only the first three have one; a fourth shares the plain one', many.size === 3 && !many.has('d') && many.get('c') === 2)
}

// ---------- One place for the cycle day, and for a date's plan ----------
{
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' || name.startsWith('preview-') ? [] : walk(path)
        return /\.tsx?$/.test(name) ? [path] : []
    })
    const sources = ['app', 'components', 'lib', 'lambda/ai-worker/src'].flatMap(walk).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    // The old way: (since % length + length) % length + 1, written wherever a cycle day was needed
    const copy = /%\s*[\w.]*cycle_?[lL]ength\s*\)\s*\+\s*[\w.]*cycle_?[lL]ength/
    const copies = sources.filter(({ path, text }) => path !== join('lib', 'periods.ts') && copy.test(text)).map(({ path }) => path)
    check('the cycle day is worked out only by cycleDayOf in lib/periods.ts', copies.length === 0, copies.join(', '))
    // A date's routine comes from plannedRoutineId, which takes the days the user changed. cycleDayOf
    // alone only labels a day ("day 3 of 7"): these files do that, next to a plan read the right way
    const labels = ['lib/periods.ts', 'lib/cycle-calendar.ts', 'components/CycleCalendar.tsx', 'components/CycleScheduler.tsx', 'lib/today-page.ts'].map((p) => join(...p.split('/')))
    const others = sources.filter(({ path, text }) => !labels.includes(path) && /\bcycleDayOf\(/.test(text)).map(({ path }) => path)
    check('a plan is read only through plannedRoutineId: elsewhere cycleDayOf would miss a day the user changed', others.length === 0, others.join(', '))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
