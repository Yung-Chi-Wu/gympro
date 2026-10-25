'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { RoutineWithExercises } from '@/app/(app)/routines/page'
import type { ExerciseOption } from './log-types'
import { calendarDay, calendarRange, monthWeeks, nextPlanned, routineColors, ROUTINE_COLORS, type CalendarCycle, type CalendarDay } from '@/lib/cycle-calendar'
import { addMonths, monthOf, setCount, type HistoryDay, type HistoryRange, type PeriodReportStatus } from '@/lib/history'
import { addDays, cycleDayOf } from '@/lib/periods'
import { formatDay, formatMonth, formatRange, weekdayLetters } from '@/lib/date-labels'
import { markNavigation } from '@/lib/nav-target'
import type { Units } from '@/lib/set-log'
import { SummaryLine } from './set-format'
import { ReportTrendChip } from './ReportTrendChip'
import { useHistoryRecords } from './use-history-records'
import { Icon } from './Icon'

// 課表's calendar: the month with what the training cycle plans for each day (lib/cycle-calendar.ts)
// and what was trained, and the picked day under it (beside it when there is room). A day's round
// is lightly filled across the month: a round is one report's period, and the report is linked
// from the day. Past days come from the same reads as 紀錄, and a trained day links to its page
// there. Months load as the user moves (use-history-records.ts).

// Phone sizes first (44px targets, 15px text), the denser desktop ones from md
const CARD = 'rounded-[14px] border border-line bg-card p-4'
const PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-[9px] bg-accent px-4 text-[15px] font-bold text-accent-ink transition-opacity hover:opacity-90 md:min-h-9 md:px-3 md:text-[13px]'
const LINK = 'inline-flex min-h-11 items-center gap-0.5 text-[15px] font-semibold text-accent md:min-h-8 md:text-sm'

// A routine's dot: its color while it has one of the first few, a plain one after
const FILL = ['bg-routine-1', 'bg-routine-2', 'bg-routine-3']
const RING = [
    'shadow-[inset_0_0_0_1.5px_var(--color-routine-1)]',
    'shadow-[inset_0_0_0_1.5px_var(--color-routine-2)]',
    'shadow-[inset_0_0_0_1.5px_var(--color-routine-3)]',
]
const PLAIN_FILL = 'bg-muted'
const PLAIN_RING = 'shadow-[inset_0_0_0_1.5px_var(--color-muted)]'

/** How many months ahead the calendar goes */
const MONTHS_AHEAD = 12

interface CycleCalendarProps {
    today: string
    cycle: CalendarCycle
    routines: RoutineWithExercises[]
    /** For the exercises' Chinese names */
    exercises: ExerciseOption[]
    initialRange: HistoryRange
    initialDays: HistoryDay[]
    initialReports: PeriodReportStatus[]
    /** The first day ever trained, so the calendar knows how far back there is anything */
    firstDate: string | null
    language: string
    units: Units
    onEditCycle: () => void
    onOpenRoutine: (routineId: string) => void
}

export function CycleCalendar({
    today,
    cycle,
    routines,
    exercises,
    initialRange,
    initialDays,
    initialReports,
    firstDate,
    language,
    units,
    onEditCycle,
    onOpenRoutine,
}: CycleCalendarProps) {
    const t = useTranslations('routines')
    const th = useTranslations('history')
    const { days, reportFor, loading, loadError, ensureLoaded } = useHistoryRecords({ initialRange, initialDays, initialReports })
    const [month, setMonth] = useState(monthOf(today))
    const [selected, setSelected] = useState(today)

    const colors = routineColors(cycle)
    const routineById = new Map(routines.map((r) => [r.id, r]))
    // A trained day is colored by the routine it was logged with, when that routine is still here
    const routineByName = new Map(routines.map((r) => [r.name, r.id]))
    const dayOf = (date: string) => calendarDay(date, cycle, today, days[date])
    const colorOf = (day: CalendarDay): number | null => {
        const id = day.status === 'done'
            ? days[day.date]?.routineNames.map((n) => routineByName.get(n)).find(Boolean) ?? day.routineId
            : day.routineId
        return id ? colors.get(id) ?? null : null
    }

    const firstMonth = monthOf(firstDate && firstDate < cycle.startDate ? firstDate : cycle.startDate)
    const lastMonth = addMonths(monthOf(today), MONTHS_AHEAD)

    // The month on screen, from the start of the round it opens in: read once it is shown (on a
    // move, for a cycle made on this page, or one whose start moved)
    const range = calendarRange(month, cycle)
    useEffect(() => {
        void ensureLoaded(range)
    }, [range.start, range.end]) // eslint-disable-line react-hooks/exhaustive-deps -- ensureLoaded is new each render and skips what is loaded

    function select(date: string) {
        setSelected(date)
        setMonth(monthOf(date))
    }

    const picked = dayOf(selected)
    const inCycle = new Set(Object.values(cycle.routineByDay).filter(Boolean) as string[])
    const legend = [...colors.entries()].sort((a, b) => a[1] - b[1]).map(([id, slot]) => ({ id, slot, name: routineById.get(id)?.name ?? '' }))
    const othersInCycle = inCycle.size > ROUTINE_COLORS

    return (
        <div className="items-start gap-4 space-y-4 @split:grid @split:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] @split:space-y-0">
            <section className={`${CARD} space-y-3`}>
                <div className="flex items-center gap-1">
                    <h2 className="min-w-0 flex-1 truncate text-base font-bold md:text-[15px]">{formatMonth(month, language)}</h2>
                    {(month !== monthOf(today) || selected !== today) && (
                        <button
                            type="button"
                            onClick={() => select(today)}
                            className="mr-1 min-h-9 rounded-full border border-line px-3 text-[13px] font-medium md:min-h-7 md:text-xs"
                        >
                            {t('calendar.today')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setMonth(addMonths(month, -1))}
                        disabled={month <= firstMonth}
                        aria-label={th('prevMonth')}
                        className="flex size-11 items-center justify-center rounded-[9px] text-muted hover:bg-done disabled:opacity-30 md:size-8"
                    >
                        <Icon name="back" className="size-5 md:size-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setMonth(addMonths(month, 1))}
                        disabled={month >= lastMonth}
                        aria-label={th('nextMonth')}
                        className="flex size-11 items-center justify-center rounded-[9px] text-muted hover:bg-done disabled:opacity-30 md:size-8"
                    >
                        <Icon name="forward" className="size-5 md:size-4" />
                    </button>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted md:text-xs">
                    <span>{t('cycleSummary', { length: cycle.cycleLength, today: cycleDayOf(cycle, today) })}</span>
                    <button type="button" onClick={onEditCycle} className="min-h-9 shrink-0 font-semibold text-accent md:min-h-0">
                        {t('editCycle')}
                    </button>
                </div>

                <div className={`transition-opacity ${loading ? 'opacity-50' : ''}`}>
                    <div className="grid grid-cols-7 pb-1 text-center text-[12px] text-faint md:text-[11px]" aria-hidden="true">
                        {weekdayLetters(language).map((w, i) => <span key={i}>{w}</span>)}
                    </div>
                    <div className="space-y-0.5">
                        {monthWeeks(month).map((week) => (
                            <div key={week[0]} className="grid grid-cols-7">
                                {week.map((date, i) => {
                                    const day = dayOf(date)
                                    const slot = colorOf(day)
                                    const inRound = day.round.start === picked.round.start
                                    const band = inRound
                                        ? `bg-accent-soft ${date === day.round.start || i === 0 ? 'rounded-l-xl' : ''} ${date === day.round.end || i === 6 ? 'rounded-r-xl' : ''}`
                                        : ''
                                    const number = date === selected
                                        ? date === today ? 'bg-accent font-bold text-accent-ink' : 'bg-ink font-bold text-card'
                                        : date === today ? 'font-bold text-accent' : ''
                                    return (
                                        <button
                                            key={date}
                                            type="button"
                                            onClick={() => select(date)}
                                            aria-pressed={date === selected}
                                            aria-current={date === today ? 'date' : undefined}
                                            aria-label={dayLabel(day)}
                                            className={`grid min-h-12 content-start justify-items-center gap-[3px] pt-1 pb-1.5 md:min-h-10 ${band} ${monthOf(date) === month ? '' : 'opacity-50'}`}
                                        >
                                            <span className={`grid size-8 place-items-center rounded-full font-mono text-sm md:size-7 md:text-xs ${number}`}>
                                                {Number(date.slice(8))}
                                            </span>
                                            <Dot day={day} slot={slot} />
                                        </button>
                                    )
                                })}
                            </div>
                        ))}
                    </div>
                </div>

                {loadError && (
                    <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-miss">
                        {th('loadError')}
                        <button type="button" onClick={() => ensureLoaded(range)} className="font-semibold text-accent">{th('retry')}</button>
                    </p>
                )}

                <div className="space-y-1 border-t border-line pt-2.5 text-[12px] text-muted md:text-[11px]">
                    <div className="flex flex-wrap gap-x-3.5 gap-y-1">
                        {legend.map(({ id, slot, name }) => (
                            <span key={id} className="inline-flex items-center gap-1.5">
                                <span className={`size-2 rounded-full ${FILL[slot]}`} />
                                {name}
                            </span>
                        ))}
                        {othersInCycle && (
                            <span className="inline-flex items-center gap-1.5">
                                <span className={`size-2 rounded-full ${PLAIN_FILL}`} />
                                {t('calendar.otherRoutines')}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-x-3.5 gap-y-1">
                        <span>{t('calendar.legendDone')}</span>
                        <span>{t('calendar.legendPlanned')}</span>
                    </div>
                </div>
            </section>

            <DayPanel
                day={picked}
                slot={colorOf(picked)}
                trained={days[picked.date]}
                today={today}
                cycle={cycle}
                routineById={routineById}
                exercises={exercises}
                report={picked.round.end < today ? reportFor(picked.round) : null}
                language={language}
                units={units}
                onOpenRoutine={onOpenRoutine}
            />
        </div>
    )

    function dayLabel(day: CalendarDay): string {
        const routine = day.routineId ? routineById.get(day.routineId)?.name : null
        const what = day.status === 'done' ? t('calendar.done')
            : day.status === 'missed' ? `${routine}${th('separator')}${t('calendar.missed')}`
            : day.status === 'rest' ? t('calendar.rest')
            : day.status === 'none' ? null
            : routine
        return [formatDay(day.date, language), what, day.date === today ? t('calendar.today') : null].filter(Boolean).join(th('separator'))
    }
}

function Dot({ day, slot }: { day: CalendarDay; slot: number | null }) {
    const hollow = day.status === 'missed' || day.status === 'today' || day.status === 'planned'
    if (day.status !== 'done' && !hollow) return <span className="size-[7px]" />
    const look = hollow ? (slot === null ? PLAIN_RING : RING[slot]) : (slot === null ? PLAIN_FILL : FILL[slot])
    return <span className={`size-[7px] rounded-full ${look}`} />
}

interface DayPanelProps {
    day: CalendarDay
    slot: number | null
    trained: HistoryDay | undefined
    today: string
    cycle: CalendarCycle
    routineById: Map<string, RoutineWithExercises>
    exercises: ExerciseOption[]
    /** The report of the day's round, once the round has ended */
    report: PeriodReportStatus | null
    language: string
    units: Units
    onOpenRoutine: (routineId: string) => void
}

/** The picked day: what was trained, or what the cycle plans; then its round and the round's report */
function DayPanel({ day, slot, trained, today, cycle, routineById, exercises, report, language, units, onOpenRoutine }: DayPanelProps) {
    const t = useTranslations('routines')
    const th = useTranslations('history')
    const ts = useTranslations('sets')
    const zh = language === 'zh-TW'
    const routine = day.routineId ? routineById.get(day.routineId) ?? null : null
    const nameOf = (exerciseId: string, fallback: string) =>
        (zh && exercises.find((ex) => ex.id === exerciseId)?.name_zh_tw) || fallback
    const shownExercises = (routine?.exercises ?? []).filter((ex) => ex.exercise_name && ex.exercise_name !== 'Unknown exercise')

    let title: string
    let status: React.ReactNode = null
    if (day.status === 'done' && trained) {
        title = trained.routineNames.join('・') || th('workout')
        status = (
            <>
                <b className="font-semibold text-good">{t('calendar.done')}</b>
                {th('separator')}{th('daySets', { count: setCount(trained) })}{th('separator')}{th('dayExercises', { count: trained.exercises.length })}
            </>
        )
    } else if (day.status === 'rest') {
        title = t('calendar.rest')
        const next = nextPlanned(cycle, day.date)
        const nextName = next ? routineById.get(next.routineId)?.name : null
        if (next && nextName) {
            const when = day.date === today && next.date === addDays(today, 1) ? t('calendar.tomorrow') : formatDay(next.date, language)
            status = t('calendar.nextTime', { when, name: nextName })
        }
    } else if (day.status === 'none') {
        title = th('notTrained')
        status = t('calendar.beforeStart', { date: formatDay(cycle.startDate, language) })
    } else {
        title = routine?.name ?? t('calendar.planned')
        const word = day.status === 'missed' ? <b className="font-semibold text-miss">{t('calendar.missed')}</b>
            : day.status === 'today' ? <b className="font-semibold">{t('calendar.notStarted')}</b>
            : <b className="font-semibold">{t('calendar.planned')}</b>
        status = <>{word}{th('separator')}{th('dayExercises', { count: shownExercises.length })}</>
    }

    const roundEnded = day.round.end < today
    return (
        <section className={`${CARD} space-y-3`} aria-live="polite">
            <div className="flex flex-wrap justify-between gap-x-3 text-[13px] text-faint md:text-xs">
                <span><span className="font-mono tracking-wider">{formatDay(day.date, language)}</span>{day.date === today ? `${th('separator')}${t('calendar.today')}` : ''}</span>
                {day.cycleDay && <span>{t('calendar.dayOf', { day: day.cycleDay, length: cycle.cycleLength })}</span>}
            </div>
            <div className="space-y-0.5">
                <h2 className="flex items-center gap-2 text-xl font-bold">
                    {(day.status === 'done' || day.routineId) && (
                        <span className={`size-2.5 shrink-0 rounded-full ${slot === null ? PLAIN_FILL : FILL[slot]}`} />
                    )}
                    {title}
                </h2>
                {status && <p className="text-[15px] text-muted md:text-sm">{status}</p>}
            </div>

            {day.status === 'done' && trained ? (
                <ul className="divide-y divide-line border-y border-line">
                    {trained.exercises.map((ex) => (
                        <li key={ex.exerciseId} className="space-y-0.5 py-2.5 md:py-2">
                            <p className="font-bold">{ex.name}</p>
                            <p className="text-[13px] text-muted">
                                <SummaryLine t={ts} logType={ex.logType} sets={ex.sets} units={units} />
                            </p>
                        </li>
                    ))}
                </ul>
            ) : routine && day.status !== 'rest' && shownExercises.length > 0 && (
                <ul className="divide-y divide-line border-y border-line">
                    {shownExercises.map((ex) => (
                        <li key={ex.id} className="flex items-baseline justify-between gap-3 py-2.5 md:py-2">
                            <span className="font-bold">{nameOf(ex.exercise_id, ex.exercise_name)}</span>
                            <span className="shrink-0 text-[13px] tabular-nums text-muted">
                                {ex.target_reps
                                    ? t('calendar.target', { sets: ex.target_sets ?? 3, reps: ex.target_reps })
                                    : t('calendar.targetSets', { sets: ex.target_sets ?? 3 })}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {day.status === 'done' && (
                <Link href={`/history?day=${day.date}`} onNavigate={() => markNavigation('/history')} className={LINK}>
                    {t('calendar.openDay')}
                    <Icon name="forward" className="size-4" />
                </Link>
            )}
            {day.status === 'today' && (
                <Link href="/dashboard" onNavigate={() => markNavigation('/dashboard')} className={PRIMARY}>
                    {t('calendar.startLogging')}
                </Link>
            )}
            {day.status === 'planned' && routine && (
                <button type="button" onClick={() => onOpenRoutine(routine.id)} className={LINK}>
                    {t('calendar.editRoutine', { name: routine.name })}
                    <Icon name="forward" className="size-4" />
                </button>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[13px] text-muted md:text-xs">
                <span>{t('calendar.round')} <span className="font-mono">{formatRange(day.round)}</span></span>
                {roundEnded && report && (report.status === 'pending' || report.trend) ? (
                    <Link
                        href={`/history?tab=reports&report=${day.round.start}`}
                        onNavigate={() => markNavigation('/history')}
                        aria-label={t('calendar.seeReport')}
                        className="inline-flex min-h-9 items-center gap-0.5"
                    >
                        <ReportTrendChip report={report} />
                        <Icon name="forward" className="size-3.5 text-faint" />
                    </Link>
                ) : day.round.start <= today && today <= day.round.end ? (
                    <span>{t('calendar.reportAfter', { date: formatDay(day.round.end, language) })}</span>
                ) : null}
            </div>
        </section>
    )
}
