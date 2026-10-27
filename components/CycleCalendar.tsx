'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { RoutineWithExercises } from '@/app/(app)/routines/page'
import type { ExerciseOption } from './log-types'
import { calendarDay, calendarRange, monthWeeks, nextPlanned, routineColors, type CalendarCycle, type CalendarDay } from '@/lib/cycle-calendar'
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
// and what was trained, and the picked day under it (beside it when there is room). A day still
// ahead lists its routine's exercises, each with a ✎ that opens it to change right there, and can
// be given another routine or made a rest day, or a rest day a routine, from 換課表 by its title (a
// sheet of what it can become): the cycle doesn't move, and
// the routine the day had isn't done that round, so the round has its sets fewer. A day's round
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
    /** Gives a date a routine, or none for a rest day; resolves to the message to show when it couldn't */
    onChangeDay: (date: string, routineId: string | null) => Promise<string | null>
    /** The routine's exercises, each to change in place (RoutineExercises): it is the routine's, so every day it is on changes */
    routineEditor: (routine: RoutineWithExercises, changeNote?: string) => ReactNode
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
    onChangeDay,
    routineEditor,
}: CycleCalendarProps) {
    const t = useTranslations('routines')
    const th = useTranslations('history')
    const { days, reportFor, loading, loadError, ensureLoaded } = useHistoryRecords({ initialRange, initialDays, initialReports })
    const [month, setMonth] = useState(monthOf(today))
    const [selected, setSelected] = useState(today)
    // The day being changed, and what went wrong
    const [dayChange, setDayChange] = useState<{ date: string; saving: boolean; error: string | null } | null>(null)

    const colors = routineColors(cycle)
    const routineById = new Map(routines.map((r) => [r.id, r]))
    // A trained day is colored by the routine it was logged with, when that routine is still here
    const routineByName = new Map(routines.map((r) => [r.name, r.id]))
    const dayOf = (date: string) => calendarDay(date, cycle, today, days[date])
    // The routine a day's dot is for: the one it was logged with, else the one it plans
    const dotRoutine = (day: CalendarDay): string | null => (day.status === 'done'
        ? days[day.date]?.routineNames.map((n) => routineByName.get(n)).find(Boolean) ?? day.routineId
        : day.routineId)
    const colorOf = (day: CalendarDay): number | null => {
        const id = dotRoutine(day)
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

    async function changeDay(date: string, routineId: string | null) {
        setDayChange({ date, saving: true, error: null })
        setDayChange({ date, saving: false, error: await onChangeDay(date, routineId) })
    }

    const picked = dayOf(selected)
    const legend = [...colors.entries()].sort((a, b) => a[1] - b[1]).map(([id, slot]) => ({ id, slot, name: routineById.get(id)?.name ?? '' }))
    // The plain dot is in the legend when the month has one: a routine past the first few, or one
    // a day was given that the cycle doesn't have
    const othersShown = monthWeeks(month).flat().some((date) => {
        const id = dotRoutine(dayOf(date))
        return !!id && !colors.has(id)
    })

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
                        {othersShown && (
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
                colors={colors}
                trained={days[picked.date]}
                today={today}
                cycle={cycle}
                routineById={routineById}
                exercises={exercises}
                report={picked.round.end < today ? reportFor(picked.round) : null}
                language={language}
                units={units}
                routines={routines}
                routineEditor={routineEditor}
                dayChange={dayChange?.date === picked.date ? dayChange : null}
                onChangeDay={(routineId) => changeDay(picked.date, routineId)}
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
    /** Each routine's color slot, for the dots of what the day can become */
    colors: Map<string, number>
    trained: HistoryDay | undefined
    today: string
    cycle: CalendarCycle
    routineById: Map<string, RoutineWithExercises>
    exercises: ExerciseOption[]
    /** The report of the day's round, once the round has ended */
    report: PeriodReportStatus | null
    language: string
    units: Units
    /** The routines a day can be given, in the cycle editor's order */
    routines: RoutineWithExercises[]
    routineEditor: (routine: RoutineWithExercises, changeNote?: string) => ReactNode
    /** The day being changed */
    dayChange: { saving: boolean; error: string | null } | null
    onChangeDay: (routineId: string | null) => void
}

/**
 * The picked day: what was trained, or what it plans, with the routine to change and the day's
 * routine to pick (or a rest day) when it is still ahead; then its round and the round's report
 */
function DayPanel({ day, slot, colors, trained, today, cycle, routineById, exercises, report, language, units, routines, routineEditor, dayChange, onChangeDay }: DayPanelProps) {
    const t = useTranslations('routines')
    const th = useTranslations('history')
    const ts = useTranslations('sets')
    const zh = language === 'zh-TW'
    const [changing, setChanging] = useState(false)
    const routine = day.routineId ? routineById.get(day.routineId) ?? null : null
    const nameOf = (exerciseId: string, fallback: string) =>
        (zh && exercises.find((ex) => ex.id === exerciseId)?.name_zh_tw) || fallback
    const shownExercises = (routine?.exercises ?? []).filter((ex) => ex.exercise_name && ex.exercise_name !== 'Unknown exercise')
    // Ahead, or today before its first set: what is changed here is what Today will show
    const editable = !!routine && (day.status === 'planned' || day.status === 'today')
    // Ahead, or today before its first set, a day can be given another routine or a rest day
    const changeable = day.status === 'planned' || day.status === 'today' || (day.status === 'rest' && day.cycleDay !== null && day.date >= today)
    // The routines and the rest day it can be changed to: all but what it has, the cycle's own marked
    const changeTo: ChangeOption[] = [
        ...routines.filter((r) => r.id !== day.routineId).map((r) => ({ id: r.id as string | null, name: r.name, slot: colors.get(r.id) ?? null })),
        ...(day.routineId ? [{ id: null, name: t('restDay'), slot: null }] : []),
    ].map((o) => ({ ...o, original: day.changed && o.id === day.cycleRoutineId }))
    // What the cycle had for a day the user changed
    const instead = day.changed && day.cycleRoutineId !== day.routineId
        ? day.cycleRoutineId
            ? t('calendar.instead', { name: routineById.get(day.cycleRoutineId)?.name ?? '' })
            : t('calendar.insteadOfRest')
        : null
    const routineDays = routine
        ? Object.entries(cycle.routineByDay).filter(([, id]) => id === routine.id).map(([d]) => Number(d)).sort((a, b) => a - b)
        : []

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
    } else if (day.status === 'rest' && instead) {
        title = t('calendar.rest')
        status = instead
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
        status = <>{word}{th('separator')}{th('dayExercises', { count: shownExercises.length })}{instead && `${th('separator')}${instead}`}</>
    }

    const roundEnded = day.round.end < today
    return (
        <section className={`${CARD} space-y-3`} aria-live="polite">
            <div className="flex flex-wrap justify-between gap-x-3 text-[13px] text-faint md:text-xs">
                <span><span className="font-mono tracking-wider">{formatDay(day.date, language)}</span>{day.date === today ? `${th('separator')}${t('calendar.today')}` : ''}</span>
                {day.cycleDay && <span>{t('calendar.dayOf', { day: day.cycleDay, length: cycle.cycleLength })}</span>}
            </div>
            <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="flex min-w-0 items-center gap-2 text-xl font-bold">
                        {(day.status === 'done' || day.routineId) && (
                            <span className={`size-2.5 shrink-0 rounded-full ${slot === null ? PLAIN_FILL : FILL[slot]}`} />
                        )}
                        {title}
                    </h2>
                    {changeable && changeTo.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setChanging(true)}
                            disabled={dayChange?.saving}
                            aria-haspopup="dialog"
                            className="-my-2 inline-flex min-h-11 shrink-0 items-center text-[15px] font-semibold text-accent disabled:opacity-50 md:min-h-8 md:text-sm"
                        >
                            {t('calendar.change')}
                        </button>
                    )}
                </div>
                {status && <p className="text-[15px] text-muted md:text-sm">{status}</p>}
            </div>

            {day.status === 'done' && trained ? (
                <ul className="divide-y divide-line border-t border-line">
                    {trained.exercises.map((ex) => (
                        <li key={ex.exerciseId} className="space-y-0.5 py-2.5 md:py-2">
                            <p className="font-bold">{ex.name}</p>
                            <p className="text-[13px] text-muted">
                                <SummaryLine t={ts} logType={ex.logType} sets={ex.sets} units={units} />
                            </p>
                        </li>
                    ))}
                </ul>
            ) : editable ? (
                routineEditor(routine, routineDays.length > 1
                    ? t('calendar.editsRoutine', { name: routine.name, days: routineDays.join(zh ? '、' : ', ') })
                    : undefined)
            ) : routine && day.status !== 'rest' && shownExercises.length === 0 ? (
                <p className="text-[15px] text-muted md:text-sm">{t('emptyRoutine')}</p>
            ) : routine && day.status !== 'rest' && (
                <ul className="divide-y divide-line border-t border-line">
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
            {changing && (
                <ChangeDaySheet
                    title={t('calendar.changeTitle', { date: formatDay(day.date, language) })}
                    options={changeTo}
                    onPick={onChangeDay}
                    onClose={() => setChanging(false)}
                />
            )}
            {dayChange?.error && <p role="alert" className="text-sm text-miss">{dayChange.error}</p>}

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

interface ChangeOption {
    /** The routine, or null for a rest day */
    id: string | null
    name: string
    slot: number | null
    /** What the cycle has for the day, which the user changed: picking it gives the day back */
    original: boolean
}

/**
 * What a day can become, never what it is, from the bottom on a phone and centered from md. A
 * native modal dialog: it sits over the tab bar, keeps focus inside, closes on Escape and gives
 * focus back to 換課表. It also closes on a pick, Cancel or a tap outside. It is put under body, out
 * of the panel's aria-live, so a screen reader reads it once, as the dialog
 */
function ChangeDaySheet({ title, options, onPick, onClose }: {
    title: string
    options: ChangeOption[]
    onPick: (routineId: string | null) => void
    onClose: () => void
}) {
    const t = useTranslations('routines')
    const ref = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    useEffect(() => {
        ref.current?.showModal()
    }, [])
    const close = () => ref.current?.close()

    return createPortal(
        <dialog
            ref={ref}
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) close() }}
            aria-labelledby={titleId}
            className="mx-0 mt-auto mb-0 w-full max-w-full overscroll-contain bg-transparent p-0 backdrop:bg-black/40 motion-safe:animate-sheet md:m-auto md:max-w-sm"
        >
            <div className="rounded-t-[18px] bg-card px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink md:rounded-[14px] md:p-5">
                <h3 id={titleId} className="text-base font-bold">{title}</h3>
                <p className="text-[13px] text-muted">{t('calendar.changeNote')}</p>
                <ul className="mt-3 border-b border-line">
                    {options.map((o) => (
                        <li key={o.id ?? 'rest'} className="border-t border-line">
                            <button
                                type="button"
                                onClick={() => { close(); onPick(o.id) }}
                                className="flex min-h-12 w-full items-center gap-2.5 text-left text-base transition-colors hover:text-accent md:min-h-10 md:text-[15px]"
                            >
                                <span className={`size-2.5 shrink-0 rounded-full ${o.id === null ? '' : o.slot === null ? PLAIN_FILL : FILL[o.slot]}`} />
                                <span className="min-w-0 flex-1">{o.name}</span>
                                {o.original && <span className="shrink-0 text-[13px] text-muted">{t('calendar.originalTag')}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
                <button
                    type="button"
                    onClick={close}
                    className="mt-4 min-h-11 w-full rounded-[9px] border border-line bg-done text-[15px] font-semibold md:min-h-9 md:text-sm"
                >
                    {t('cancel')}
                </button>
            </div>
        </dialog>,
        document.body,
    )
}
