'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
    PieChart, Pie, Cell,
    Tooltip, ResponsiveContainer,
} from 'recharts'
import { WeightTrendCard } from '@/components/WeightTrendCard'
import type { AiRecommendation } from './types'
import { toDisplayWeight, type WeightUnit } from '@/lib/weight-unit'
import { addDays, localDate, periodEndFor, type CycleSettings } from '@/lib/periods'
import type { Units } from '@/lib/set-log'
import {
    addMonths, bestSetOf, datesIn, isDate, isMonth, isTrained, monthOf, monthRange, periodsBack, periodsInMonth,
    periodsSpanning, PERIODS_PER_PAGE, rangeOf, REPORTS_PER_PAGE, setCount,
    type HistoryDay, type HistoryRange, type PeriodRange, type PeriodReportStatus,
} from '@/lib/history'
import { closeSubPage, openSubPage } from '@/lib/sub-page'
import { compactSet, SummaryLine } from './set-format'
import { Icon } from './Icon'
import { isReportV3, ReportView } from './report/ReportView'
import { FailedReport } from './report/FailedReport'

// The 紀錄 page's tabs. Training, side by side (@split): a month calendar and that
// month's periods on the left, the chosen day on the right. On a phone: the days grouped
// by period, four periods at a time, and a day opens as a page of its own (?day=, see
// lib/sub-page.ts). Only the ranges on screen are loaded (lib/history.ts).

export type HistoryTab = 'training' | 'weight' | 'reports'

// Phone sizes first (44px targets, 15px text), the denser desktop ones from md
const CARD = 'rounded-[14px] border border-line bg-card p-4'
const BUTTON = 'inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-[9px] border border-line bg-card px-4 text-[15px] font-bold transition-colors hover:bg-done disabled:opacity-50 md:min-h-9 md:px-3 md:text-[13px]'

// ---------- Dates ----------

const locale = (language: string) => (language === 'zh-TW' ? 'zh-TW' : 'en-US')
// A YYYY-MM-DD date at noon UTC, formatted in UTC: the same on the server and in any browser
const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`)

/** 10/8 週四, or Thu, Oct 8 */
function formatDay(date: string, language: string): string {
    const d = noonUtc(date)
    if (language !== 'zh-TW') {
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    }
    const weekday = d.toLocaleDateString('zh-TW', { weekday: 'short', timeZone: 'UTC' })
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${weekday}`
}

/** 10/5–10/11 */
const formatRange = ({ start, end }: HistoryRange) =>
    `${Number(start.slice(5, 7))}/${Number(start.slice(8))}–${Number(end.slice(5, 7))}/${Number(end.slice(8))}`

/** 2026 年 10 月, or October 2026 */
function formatMonth(month: string, language: string): string {
    const [y, m] = month.split('-').map(Number)
    if (language === 'zh-TW') return `${y} 年 ${m} 月`
    return noonUtc(`${month}-01`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' })
}

// ---------- Tabs ----------

const TABS: { tab: HistoryTab; href: string }[] = [
    { tab: 'training', href: '/history' },
    { tab: 'weight', href: '/history?tab=weight' },
    { tab: 'reports', href: '/history?tab=reports' },
]

/** 訓練 / 體重 / 報告. Each is its own link, so a tab loads only its own data. */
export function HistoryTabs({ current }: { current: HistoryTab }) {
    const t = useTranslations('history')
    // A day's page on a phone has the top bar's back button instead
    const onDayPage = useSearchParams().has('day')

    return (
        <nav aria-label={t('title')} className={`gap-1 border-b border-line ${onDayPage ? 'hidden @split:flex' : 'flex'}`}>
            {TABS.map(({ tab, href }) => (
                <Link
                    key={tab}
                    href={href}
                    scroll={false}
                    aria-current={tab === current ? 'page' : undefined}
                    className={`-mb-px flex min-h-11 items-center border-b-2 px-4 text-[15px] font-medium transition-colors md:min-h-0 md:px-3 md:py-2 md:text-sm ${tab === current ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                >
                    {t(`tabs.${tab}`)}
                </Link>
            ))}
        </nav>
    )
}

// ---------- Training ----------

interface HistoryTrainingProps {
    /** Today in the user's time zone */
    today: string
    /** The calendar's first month: this one, or the month of a linked day */
    initialMonth: string
    cycle: CycleSettings | null
    /** Training days in one round of the cycle; null without a cycle */
    plannedPerPeriod: number | null
    initialRange: HistoryRange
    initialDays: HistoryDay[]
    initialReports: PeriodReportStatus[]
    /** The first day ever trained: there is nothing older to load */
    firstDate: string | null
    language: string
    units: Units
}

export function HistoryTraining({
    today,
    initialMonth,
    cycle,
    plannedPerPeriod,
    initialRange,
    initialDays,
    initialReports,
    firstDate,
    language,
    units,
}: HistoryTrainingProps) {
    const t = useTranslations('history')
    const searchParams = useSearchParams()
    const [days, setDays] = useState<Record<string, HistoryDay>>(() => Object.fromEntries(initialDays.map((d) => [d.date, d])))
    const [reports, setReports] = useState<Record<string, PeriodReportStatus>>(() =>
        Object.fromEntries(initialReports.map((r) => [r.periodStart, r])))
    const [loaded, setLoaded] = useState<HistoryRange[]>([initialRange])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState(false)
    // Side by side: the calendar's month
    const [month, setMonth] = useState(initialMonth)
    // The phone's list: `count` periods back from the one containing `from`; `month` after a jump
    const [list, setList] = useState<{ from: string; count: number; month: string | null }>(
        { from: today, count: PERIODS_PER_PAGE, month: null })

    const isLoaded = (range: HistoryRange) =>
        datesIn(range).every((d) => loaded.some((l) => l.start <= d && d <= l.end))

    /** Loads a range unless it is already here. False when it couldn't be loaded. */
    async function ensureLoaded(range: HistoryRange): Promise<boolean> {
        if (isLoaded(range)) return true
        setLoading(true)
        setLoadError(false)
        try {
            const res = await fetch(`/api/history/workouts?start=${range.start}&end=${range.end}`)
            const data = await res.json().catch(() => null)
            if (!res.ok || !Array.isArray(data?.days)) throw new Error(`History request failed: ${res.status}`)
            setDays((prev) => {
                const next = { ...prev }
                for (const d of datesIn(range)) delete next[d]
                for (const day of data.days as HistoryDay[]) next[day.date] = day
                return next
            })
            setReports((prev) => ({
                ...prev,
                ...Object.fromEntries((data.reports as PeriodReportStatus[]).map((r) => [r.periodStart, r])),
            }))
            setLoaded((prev) => [...prev, range])
            return true
        } catch (err) {
            console.error(err)
            setLoadError(true)
            return false
        } finally {
            setLoading(false)
        }
    }

    const reportFor = (period: HistoryRange) =>
        Object.values(reports).find((r) => period.start <= r.periodStart && r.periodStart <= period.end) ?? null
    /** The period's training days, newest first */
    const trainedIn = (period: HistoryRange) => datesIn(period).filter((d) => isTrained(days[d])).reverse()

    // ---- Side by side: the month ----
    const monthPeriods = periodsInMonth(month, cycle, today).filter((p) => p.start <= today)
    const latestInMonth = datesIn(monthRange(month)).filter((d) => d <= today && isTrained(days[d])).pop() ?? null
    const dayParam = searchParams.get('day')
    const opened = isDate(dayParam) ? dayParam : null
    const selected = opened ?? latestInMonth

    async function showMonth(next: string) {
        setMonth(next)
        await ensureLoaded(rangeOf(periodsInMonth(next, cycle, today)))
    }

    // ---- Phone: the periods ----
    const listPeriods = periodsBack(list.from, list.count, cycle, today)
    const oldest = listPeriods[listPeriods.length - 1]
    const hasOlder = !!firstDate && firstDate < oldest.start

    async function loadOlder() {
        const more = periodsBack(addDays(oldest.start, -1), PERIODS_PER_PAGE, cycle, today)
        if (await ensureLoaded(rangeOf(more))) setList((l) => ({ ...l, count: l.count + PERIODS_PER_PAGE }))
    }

    async function jumpTo(target: string) {
        const range = monthRange(target)
        const from = range.end < today ? range.end : today
        const periods = periodsSpanning({ start: range.start, end: from }, cycle, today)
        if (await ensureLoaded(rangeOf(periods))) setList({ from, count: periods.length, month: target })
    }

    const sessions = (period: PeriodRange) => {
        if (!isLoaded(period)) return '…'
        const done = trainedIn(period).length
        return plannedPerPeriod ? t('sessionsOfPlan', { done, planned: plannedPerPeriod }) : t('sessions', { count: done })
    }

    return (
        <div className="items-start gap-4 @split:grid @split:grid-cols-[minmax(270px,320px)_minmax(0,1fr)]">

            {/* Side by side: the month and its periods */}
            <div className="hidden space-y-4 @split:block">
                <section className={`${CARD} space-y-3`}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-[15px] font-bold">{formatMonth(month, language)}</h2>
                        <div className="flex">
                            <button
                                type="button"
                                onClick={() => showMonth(addMonths(month, -1))}
                                disabled={!firstDate || addMonths(month, -1) < monthOf(firstDate)}
                                aria-label={t('prevMonth')}
                                className="flex size-8 items-center justify-center rounded-[7px] text-muted hover:bg-done disabled:opacity-30"
                            >
                                <Icon name="back" className="size-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => showMonth(addMonths(month, 1))}
                                disabled={month >= monthOf(today)}
                                aria-label={t('nextMonth')}
                                className="flex size-8 items-center justify-center rounded-[7px] text-muted hover:bg-done disabled:opacity-30"
                            >
                                <Icon name="forward" className="size-4" />
                            </button>
                        </div>
                    </div>
                    <MonthCalendar
                        month={month}
                        today={today}
                        selected={selected}
                        days={days}
                        language={language}
                        dimmed={loading}
                        onSelect={(date) => openSubPage('day', date)}
                    />
                </section>

                <section className={`${CARD} space-y-1`}>
                    <h2 className="pb-1 text-[15px] font-bold">{t('periods')}</h2>
                    <ul className="divide-y divide-line">
                        {monthPeriods.map((period) => {
                            const latest = trainedIn(period)[0]
                            return (
                                <li key={period.start}>
                                    <button
                                        type="button"
                                        disabled={!latest}
                                        onClick={() => latest && openSubPage('day', latest)}
                                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-2.5 text-left disabled:cursor-default"
                                    >
                                        <span className="font-mono text-sm font-bold">{formatRange(period)}</span>
                                        <span className="row-span-2"><TrendChip report={reportFor(period)} /></span>
                                        <span className="text-xs text-muted">
                                            {sessions(period)}
                                            {period.current && `${t('separator')}${t('inProgress')}`}
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </section>
                {loadError && <LoadError onRetry={() => showMonth(month)} />}
            </div>

            {/* Phone: the days, grouped by period */}
            <div className={`space-y-6 md:space-y-3 @split:hidden ${opened ? 'hidden' : ''}`}>
                <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-muted md:text-xs">
                        {list.month ? formatMonth(list.month, language) : t('recentPeriods', { count: PERIODS_PER_PAGE })}
                    </span>
                    <div className="flex items-center gap-3">
                        {list.month && (
                            <button
                                type="button"
                                onClick={() => setList({ from: today, count: PERIODS_PER_PAGE, month: null })}
                                className="min-h-11 text-[13px] font-medium text-accent md:min-h-8 md:text-xs"
                            >
                                {t('backToRecent')}
                            </button>
                        )}
                        {firstDate && (
                            <label className="relative inline-flex min-h-11 items-center gap-1 rounded-full bg-done px-4 text-[13px] text-muted md:min-h-8 md:px-3 md:text-xs">
                                {t('jumpToMonth')}
                                <span aria-hidden="true">▾</span>
                                <input
                                    type="month"
                                    value={list.month ?? ''}
                                    min={monthOf(firstDate)}
                                    max={monthOf(today)}
                                    onChange={(e) => { if (isMonth(e.target.value)) void jumpTo(e.target.value) }}
                                    onClick={(e) => {
                                        try {
                                            e.currentTarget.showPicker()
                                        } catch {
                                            // Not supported: the browser opens its own picker on focus
                                        }
                                    }}
                                    aria-label={t('jumpToMonth')}
                                    className="absolute inset-0 min-h-0! cursor-pointer opacity-0"
                                />
                            </label>
                        )}
                    </div>
                </div>

                {!firstDate && <p className={`${CARD} text-[15px] text-muted md:text-sm`}>{t('noHistory')}</p>}

                {firstDate && listPeriods.map((period) => {
                    const trained = trainedIn(period)
                    return (
                        <section key={period.start} className="space-y-2 md:space-y-1.5">
                            <h2 className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-[13px] tracking-wide text-muted md:text-xs md:text-faint">
                                {period.current && <span>{t('thisPeriod')}</span>}
                                <span className="font-mono">{formatRange(period)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{sessions(period)}</span>
                                <TrendChip report={reportFor(period)} />
                            </h2>
                            <div className="rounded-[14px] border border-line bg-card px-4 md:px-3">
                                {trained.length === 0 ? (
                                    <p className="py-4 text-[15px] text-faint md:py-3 md:text-sm">{t('noTraining')}</p>
                                ) : (
                                    <ul className="divide-y divide-line">
                                        {trained.map((date) => (
                                            <li key={date}>
                                                <DayRow day={days[date]} language={language} units={units} onOpen={() => openSubPage('day', date)} />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </section>
                    )
                })}

                {loadError && <LoadError onRetry={list.month ? () => jumpTo(list.month as string) : loadOlder} />}
                {hasOlder && (
                    <div className="flex justify-center">
                        <button type="button" onClick={loadOlder} disabled={loading} className={BUTTON}>
                            {loading ? t('loading') : t('loadOlder', { count: PERIODS_PER_PAGE })}
                        </button>
                    </div>
                )}
            </div>

            {/* The chosen day: on the right, or its own page on a phone */}
            <div className={`${opened ? '' : 'hidden'} @split:block`}>
                {selected ? (
                    <DayDetail date={selected} day={days[selected]} language={language} units={units} />
                ) : (
                    <div className={`${CARD} py-10 text-center text-[15px] text-muted md:text-sm`}>
                        {loading ? t('loading') : t('noTrainingThisMonth')}
                    </div>
                )}
            </div>
        </div>
    )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
    const t = useTranslations('history')
    return (
        <p role="alert" className="flex items-center justify-between gap-3 text-[15px] text-miss md:text-sm">
            {t('loadError')}
            <button type="button" onClick={onRetry} className="min-h-11 font-medium underline md:min-h-0">{t('retry')}</button>
        </p>
    )
}

/** The verdict of a period's report, as a small label */
function TrendChip({ report }: { report: PeriodReportStatus | null }) {
    const t = useTranslations('history')
    const tV3 = useTranslations('reportV3')
    if (!report) return null
    if (report.status === 'pending') return <span className="whitespace-nowrap rounded-full bg-done px-2 text-[13px] text-muted md:text-xs">{t('reportPending')}</span>
    if (!report.trend) return null
    const tone = report.trend === 'progressing'
        ? 'bg-good-soft text-good'
        : report.trend === 'regressing' ? 'bg-accent-soft text-miss' : 'bg-done text-muted'
    return (
        <span className={`whitespace-nowrap rounded-full px-2 text-[13px] font-medium md:text-xs ${tone}`}>
            {t('reportTrend', { trend: tV3(`status.${report.trend}`) })}
        </span>
    )
}

/** One day in the phone's list: the date and routine, its sets, and its first exercise's best set */
function DayRow({ day, language, units, onOpen }: { day: HistoryDay; language: string; units: Units; onOpen: () => void }) {
    const t = useTranslations('history')
    const ts = useTranslations('sets')
    const best = bestSetOf(day)
    const title = day.routineNames.join('・') || t('workout')
    const highlight = best
        ? `${best.exercise.name} ${compactSet(ts, best.exercise.logType, best.set, units)}`
        : day.exercises.map((ex) => ex.name).join(t('listJoiner'))

    return (
        <button type="button" onClick={onOpen} className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] content-center items-center gap-x-2 gap-y-0.5 py-2.5 text-left md:min-h-0 md:gap-y-0">
            <span className="truncate font-bold">{formatDay(day.date, language)}{t('separator')}{title}</span>
            <Icon name="forward" className="row-span-2 size-4 text-faint" />
            <span className="truncate text-[13px] text-muted md:text-xs">
                {t('daySets', { count: setCount(day) })}{t('separator')}{highlight}
            </span>
        </button>
    )
}

interface MonthCalendarProps {
    month: string
    today: string
    selected: string | null
    days: Record<string, HistoryDay>
    language: string
    dimmed: boolean
    onSelect: (date: string) => void
}

/** A month, Monday first, with the trained days marked */
function MonthCalendar({ month, today, selected, days, language, dimmed, onSelect }: MonthCalendarProps) {
    const { start, end } = monthRange(month)
    // From the Monday before the 1st to the Sunday after the last day
    const lead = (noonUtc(start).getUTCDay() + 6) % 7
    const trail = 6 - ((noonUtc(end).getUTCDay() + 6) % 7)
    const cells = datesIn({ start: addDays(start, -lead), end: addDays(end, trail) })
    // 2024-01-01 was a Monday
    const weekdays = datesIn({ start: '2024-01-01', end: '2024-01-07' }).map((d) =>
        noonUtc(d).toLocaleDateString(locale(language), { weekday: 'narrow', timeZone: 'UTC' }))

    return (
        <div className={`grid grid-cols-7 gap-1 text-center transition-opacity ${dimmed ? 'opacity-50' : ''}`}>
            {weekdays.map((w, i) => <span key={i} className="text-[11px] text-faint">{w}</span>)}
            {cells.map((date) => {
                const inMonth = date >= start && date <= end
                const day = Number(date.slice(8))
                if (!inMonth || date > today) {
                    return (
                        <span key={date} className={`grid h-8 place-items-center font-mono text-xs text-faint ${inMonth ? '' : 'opacity-50'}`}>
                            {day}
                        </span>
                    )
                }
                const trained = isTrained(days[date])
                const ring = date === selected
                    ? 'shadow-[inset_0_0_0_1.5px_var(--color-ink)]'
                    : date === today ? 'text-accent shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : ''
                return (
                    <button
                        key={date}
                        type="button"
                        onClick={() => onSelect(date)}
                        aria-pressed={date === selected}
                        aria-label={formatDay(date, language)}
                        className={`grid h-8 place-items-center rounded-[8px] font-mono text-xs ${trained ? 'bg-good-soft font-bold text-good' : 'text-muted hover:bg-done'} ${ring}`}
                    >
                        {day}
                    </button>
                )
            })}
        </div>
    )
}

/** What the user did on one day: each exercise with its sets and best set, and the day's note */
function DayDetail({ date, day, language, units }: { date: string; day: HistoryDay | undefined; language: string; units: Units }) {
    const t = useTranslations('history')
    const ts = useTranslations('sets')
    const trained = isTrained(day)
    const title = day?.routineNames.join('・') || (trained ? t('workout') : t('notTrained'))

    return (
        <section className={`${CARD} space-y-3`}>
            {/* Back to the list when the page is too narrow for both and there is no phone top bar */}
            <button
                type="button"
                onClick={() => closeSubPage('day')}
                className="hidden min-h-9 items-center gap-0.5 text-sm font-medium text-accent md:@max-split:flex"
            >
                <Icon name="back" className="size-4" />
                {t('title')}
            </button>

            <div className="space-y-0.5">
                <p className="font-mono text-[13px] tracking-wider text-faint md:text-xs">{formatDay(date, language)}</p>
                <h2 className="text-xl font-bold">{title}</h2>
                {day && trained && (
                    <p className="text-[15px] text-muted md:hidden">
                        {t('daySets', { count: setCount(day) })}{t('separator')}{t('dayExercises', { count: day.exercises.length })}
                    </p>
                )}
            </div>

            {day && trained && (
                <>
                    <div className="hidden max-w-xs grid-cols-2 gap-2 md:grid">
                        <div className="grid rounded-[10px] bg-done px-3 py-2">
                            <span className="text-[11px] text-muted">{t('statSets')}</span>
                            <span className="font-mono text-base font-bold">{setCount(day)}</span>
                        </div>
                        <div className="grid rounded-[10px] bg-done px-3 py-2">
                            <span className="text-[11px] text-muted">{t('statExercises')}</span>
                            <span className="font-mono text-base font-bold">{day.exercises.length}</span>
                        </div>
                    </div>

                    <ul className="divide-y divide-line">
                        {day.exercises.map((ex) => (
                            <li key={ex.exerciseId} className="space-y-1 py-3 md:space-y-0.5 md:py-2.5">
                                <p className="font-bold">{ex.name}</p>
                                <p className="text-[13px] text-muted">
                                    <SummaryLine t={ts} logType={ex.logType} sets={ex.sets} units={units} />
                                </p>
                                <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[13px] text-muted md:text-xs">
                                    {ex.sets.map((s, i) => (
                                        <span key={i} className="whitespace-nowrap">
                                            <span className="text-faint">{i + 1}</span> {compactSet(ts, ex.logType, s, units)}
                                        </span>
                                    ))}
                                </p>
                            </li>
                        ))}
                    </ul>
                </>
            )}

            {day?.note && (
                <p className="border-t border-line pt-3 text-[15px] text-muted md:rounded-[10px] md:border md:px-3 md:py-2 md:text-[13px]">
                    {t('noteLine', { note: day.note })}
                </p>
            )}
        </section>
    )
}

// ---------- Body weight ----------

interface WeightEntry {
    id: string
    recordedAt: string
    weightKg: number | null
}

const WEIGH_INS_PER_PAGE = 30

/** The weight chart, and every weigh-in of the last year in the reading unit */
export function HistoryWeight({ entries, weightUnit, language, timeZone }: {
    entries: WeightEntry[]
    weightUnit: WeightUnit
    language: string
    timeZone: string
}) {
    const t = useTranslations('history')
    const [shown, setShown] = useState(WEIGH_INS_PER_PAGE)
    const weighIns = entries.filter((e) => e.weightKg !== null).reverse()

    return (
        <div className="max-w-3xl space-y-5 md:space-y-4">
            <WeightTrendCard entries={entries} language={language} weightUnit={weightUnit} />

            <section className={`${CARD} space-y-1`}>
                <h2 className="text-base font-bold md:text-[15px]">{t('weighIns')}</h2>
                <p className="text-[13px] text-muted md:text-xs">{t('lastYear')}</p>
                {weighIns.length === 0 ? (
                    <p className="py-2 text-[15px] text-muted md:text-sm">{t('noWeightData')}</p>
                ) : (
                    <ul className="divide-y divide-line">
                        {weighIns.slice(0, shown).map((e) => (
                            <li key={e.id} className="flex min-h-[52px] items-center justify-between text-[15px] md:min-h-0 md:py-2 md:text-sm">
                                <span>{formatDay(localDate(timeZone, new Date(e.recordedAt)), language)}</span>
                                <span className="font-mono font-bold">
                                    {toDisplayWeight(e.weightKg as number, weightUnit)} <span className="font-medium text-muted">{weightUnit}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {weighIns.length > shown && (
                    <button type="button" onClick={() => setShown((n) => n + WEIGH_INS_PER_PAGE)} className={`${BUTTON} mt-2`}>
                        {t('showMore')}
                    </button>
                )}
            </section>
        </div>
    )
}

// ---------- Reports ----------

interface ReportRow {
    period_start: string
    status: string
    recommendation: unknown
    error_message: string | null
    created_at: string
}

const CHART_COLORS = ['#26241F', '#8A5A44', '#4A6B5A', '#5A6B8A', '#8A7A44', '#6B4A6B']
const SEVERITY_STYLES: Record<string, string> = {
    mild: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    moderate: 'bg-orange-50 text-orange-800 border-orange-200',
    severe: 'bg-red-50 text-red-800 border-red-200',
}

/** Every period's report, newest first, a page at a time; each opens in place */
export function HistoryReports({ initialReports, cycle, language, weightUnit }: {
    initialReports: ReportRow[]
    cycle: CycleSettings | null
    language: string
    weightUnit: WeightUnit
}) {
    const t = useTranslations('history')
    // The first page comes from the server (and refreshes with it); older pages are added here
    const [older, setOlder] = useState<ReportRow[]>([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState(false)
    const [noMore, setNoMore] = useState(initialReports.length < REPORTS_PER_PAGE)
    const reports = [...initialReports, ...older]

    async function loadOlder() {
        const last = reports[reports.length - 1]
        if (!last) return
        setLoading(true)
        setLoadError(false)
        try {
            const res = await fetch(`/api/history/reports?before=${last.period_start}`)
            const data = await res.json().catch(() => null)
            if (!res.ok || !Array.isArray(data?.reports)) throw new Error(`Reports request failed: ${res.status}`)
            setOlder((prev) => [...prev, ...data.reports])
            if (data.reports.length < REPORTS_PER_PAGE) setNoMore(true)
        } catch (err) {
            console.error(err)
            setLoadError(true)
        } finally {
            setLoading(false)
        }
    }

    if (reports.length === 0) {
        return <p className={`${CARD} max-w-3xl text-[15px] text-muted md:text-sm`}>{t('noReports')}</p>
    }

    return (
        <div className="max-w-3xl space-y-4 md:space-y-3">
            {reports.map((report) => (
                <ReportItem
                    key={report.period_start}
                    report={report}
                    periodEnd={periodEndFor(report.period_start, cycle)}
                    language={language}
                    weightUnit={weightUnit}
                />
            ))}
            {loadError && <LoadError onRetry={loadOlder} />}
            {!noMore && (
                <div className="flex justify-center">
                    <button type="button" onClick={loadOlder} disabled={loading} className={BUTTON}>
                        {loading ? t('loading') : t('olderReports')}
                    </button>
                </div>
            )}
        </div>
    )
}

/** One report: its period and verdict; opened, the whole report */
function ReportItem({ report, periodEnd, language, weightUnit }: {
    report: ReportRow
    periodEnd: string
    language: string
    weightUnit: WeightUnit
}) {
    const t = useTranslations('report')
    const tV3 = useTranslations('reportV3')
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const [showMore, setShowMore] = useState(false)
    const reload = useCallback(() => router.refresh(), [router])

    // Nothing pushes the worker's result back: while an open report is being made, reload it
    useEffect(() => {
        if (!isOpen || report.status !== 'pending') return
        const timer = setInterval(reload, 5000)
        return () => clearInterval(timer)
    }, [isOpen, report.status, reload])

    const isCompleted = report.status === 'completed'
    const v3 = isCompleted && isReportV3(report.recommendation) ? report.recommendation : null
    const rec = isCompleted && !v3 ? (report.recommendation as unknown as AiRecommendation) : null

    return (
        <section className="rounded-[14px] border border-line bg-card">
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                aria-expanded={isOpen}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left md:min-h-0"
            >
                <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[15px] font-bold md:text-sm">{formatRange({ start: report.period_start, end: periodEnd })}</span>
                    <TrendChip report={{ periodStart: report.period_start, status: report.status, trend: v3?.facts.status ?? null }} />
                </span>
                <Icon name="forward" className={`size-4 text-faint transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>

            {isOpen && (
                <div className="space-y-4 border-t border-line px-4 py-4">
                    {report.status === 'pending' && (
                        <div className="flex items-center gap-2 text-[15px] text-muted md:text-sm">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-ink" />
                            {t('pending')}
                        </div>
                    )}

                    {report.status === 'insufficient_data' && (
                        <p className="text-[15px] text-muted md:text-sm">{tV3('insufficient')}</p>
                    )}

                    {v3 && <ReportView report={v3} language={language} weightUnit={weightUnit} />}

                    {report.status === 'failed' && <FailedReport periodStart={report.period_start} onRetried={reload} />}

                    {rec && (
                        <div className="space-y-4">
                            <p className="font-medium text-[15px] md:text-sm">{rec.headline}</p>

                            {!showMore ? (
                                <button
                                    type="button"
                                    onClick={() => setShowMore(true)}
                                    className="min-h-11 text-[15px] text-accent underline hover:opacity-70 transition-opacity md:min-h-0 md:text-sm"
                                >
                                    {t('readMore')}
                                </button>
                            ) : (
                                <div className="space-y-4">
                                    {Object.keys(rec.volumeSplit ?? {}).length > 0 && (
                                        <div>
                                            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink/40 md:text-xs mb-2">
                                                {t('trainingSplit')}
                                            </p>
                                            <div className="h-36">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie
                                                            data={Object.entries(rec.volumeSplit).map(([name, value]) => ({ name, value }))}
                                                            dataKey="value"
                                                            nameKey="name"
                                                            outerRadius={50}
                                                        >
                                                            {Object.entries(rec.volumeSplit).map((_, i) => (
                                                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <Tooltip formatter={(value: number) => `${value}%`} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink/40 md:text-xs mb-1">
                                            {t('summary')}
                                        </p>
                                        <p className="text-[15px] text-gray-700 md:text-sm">{rec.summary}</p>
                                    </div>

                                    <div>
                                        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink/40 md:text-xs mb-1">
                                            {t('progressiveOverload')}
                                        </p>
                                        <p className="text-[15px] text-gray-600 md:text-sm">{rec.progressiveOverload.notes}</p>
                                    </div>

                                    {rec.muscleImbalances.length > 0 && (
                                        <div>
                                            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink/40 md:text-xs mb-2">
                                                {t('thingsToWatch')}
                                            </p>
                                            <div className="space-y-2">
                                                {rec.muscleImbalances.map((item, i) => (
                                                    <div
                                                        key={i}
                                                        className={`rounded px-3 py-2 text-[15px] max-md:border-0 md:border md:text-sm ${SEVERITY_STYLES[item.severity] ?? ''}`}
                                                    >
                                                        <span className="font-semibold capitalize">{item.muscleGroup}</span>
                                                        {' — '}
                                                        {item.observation}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {rec.deloadRecommended && (
                                        <div className="rounded bg-red-50 px-3 py-2 text-[15px] text-red-800 md:border md:border-red-200 md:text-sm">
                                            <span className="font-semibold">{t('deloadRecommended')} </span>
                                            {rec.deloadReason}
                                        </div>
                                    )}

                                    <div>
                                        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink/40 md:text-xs mb-2">
                                            {t('whatToDoNext')}
                                        </p>
                                        <ul className="list-disc list-inside space-y-1 text-[15px] md:text-sm">
                                            {rec.actionItems.map((item, i) => (
                                                <li key={i}>{item}</li>
                                            ))}
                                        </ul>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setShowMore(false)}
                                        className="min-h-11 text-[15px] text-ink/40 underline md:min-h-0 md:text-sm"
                                    >
                                        {t('showLess')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    )
}
