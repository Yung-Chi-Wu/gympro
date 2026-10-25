'use client'

import { useState } from 'react'
import { datesIn, type HistoryDay, type HistoryRange, type PeriodReportStatus } from '@/lib/history'
import { reportClientError, responseError } from '@/lib/report-client-error'

// The days trained and the reports of the periods in the ranges loaded so far, for 紀錄's list and
// month and for 課表's calendar. The page renders with one range; others load from
// /api/history/workouts as the user moves, each once.

export function useHistoryRecords({ initialRange, initialDays, initialReports }: {
    initialRange: HistoryRange
    initialDays: HistoryDay[]
    initialReports: PeriodReportStatus[]
}) {
    const [days, setDays] = useState<Record<string, HistoryDay>>(() => Object.fromEntries(initialDays.map((d) => [d.date, d])))
    const [reports, setReports] = useState<Record<string, PeriodReportStatus>>(() =>
        Object.fromEntries(initialReports.map((r) => [r.periodStart, r])))
    const [loaded, setLoaded] = useState<HistoryRange[]>([initialRange])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState(false)

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
            if (!res.ok || !Array.isArray(data?.days)) throw responseError(`History request failed: ${res.status}`, res.status, data)
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
            reportClientError('client/history/load-days', err)
            setLoadError(true)
            return false
        } finally {
            setLoading(false)
        }
    }

    /** The report of the period that starts within it, if there is one */
    const reportFor = (period: HistoryRange) =>
        Object.values(reports).find((r) => period.start <= r.periodStart && r.periodStart <= period.end) ?? null

    return { days, reportFor, loading, loadError, isLoaded, ensureLoaded }
}
