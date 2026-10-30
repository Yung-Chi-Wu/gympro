import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './types/database.types'
import { MAX_RANGE_DAYS, type HistoryRange, type PeriodReportStatus } from './history'
import { daysBetween } from './periods'
import { reportError } from './report-error'
import { loadReportStatuses, readFirstTrainedAt, readHistoryRows, reportStatusesOf, type HistoryRows, type ReportStatusRow } from './history-data'

// The rows a month of training takes, for 紀錄's training tab (app/(app)/history/page.tsx) and
// 課表's calendar (lib/routines-page.ts): the cycle with its days, the workouts and day notes, the
// reports, and the first day trained. In one request when it can: history_page (migration
// 20261030230000) reads the same rows as the requests below and returns them nested the same
// way. Nothing here needs the user's time zone: the range is read wide enough for any, and cut
// to the user's after.

export interface CycleRow {
    id: string
    cycle_length: number
    start_date: string
    cycle_days: { day_index: number; routine_id: string | null }[]
    cycle_date_changes: { change_date: string; routine_id: string | null }[]
}

/** A month's rows, read either way */
export interface HistoryData {
    cycle: CycleRow | null
    history: HistoryRows
    reports: PeriodReportStatus[]
    firstTrainedAt: string | null
}

/** What history_page returns: the rows, as the requests read them */
export interface HistoryPageRows {
    cycle: CycleRow | null
    workouts: HistoryRows['workouts']
    notes: { note_date: string; note: string }[]
    reports: ReportStatusRow[]
    first_trained_at: string | null
}

/** A month's rows in one request, for `range` */
function readHistoryPage(supabase: SupabaseClient<Database>, range: HistoryRange) {
    return supabase.rpc('history_page', { p_start: range.start, p_end: range.end }, { get: true })
}

/** A month's rows from history_page's answer (or routines_page's, which holds it), as the requests' are */
export function historyFromPage(rows: Json): HistoryData {
    const page = rows as unknown as HistoryPageRows
    return {
        cycle: page.cycle,
        history: { workouts: page.workouts, notes: new Map(page.notes.map((n) => [n.note_date, n.note])) },
        reports: reportStatusesOf(page.reports),
        firstTrainedAt: page.first_trained_at,
    }
}

/** A month's rows in one round of requests, for when the function can't be used */
export async function loadHistoryData(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange): Promise<HistoryData> {
    const [cycleResult, history, reports, firstTrainedAt] = await Promise.all([
        supabase
            .from('training_cycles')
            .select('id, cycle_length, start_date, cycle_days ( day_index, routine_id ), cycle_date_changes ( change_date, routine_id )')
            .eq('user_id', userId)
            .order('day_index', { referencedTable: 'cycle_days' })
            .maybeSingle(),
        readHistoryRows(supabase, userId, range),
        loadReportStatuses(supabase, userId, range),
        readFirstTrainedAt(supabase, userId),
    ])
    return { cycle: cycleResult.data, history, reports, firstTrainedAt }
}

/**
 * A month's rows for `range`: in one request, or the old way when the call fails (the error is
 * logged) or the range is longer than the function takes, as a link to a day long ago can make it
 */
export async function readHistoryData(supabase: SupabaseClient<Database>, userId: string, range: HistoryRange): Promise<HistoryData> {
    if (daysBetween(range.start, range.end) <= MAX_RANGE_DAYS) {
        const page = await readHistoryPage(supabase, range)
        if (page.data) return historyFromPage(page.data)
        reportError('history-page', page.error, { userId })
    }
    return loadHistoryData(supabase, userId, range)
}
