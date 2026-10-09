import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { daysBetween } from '@/lib/periods'
import { isDate, MAX_RANGE_DAYS } from '@/lib/history'
import { loadHistoryDays, loadReportStatuses } from '@/lib/history-data'

// The 紀錄 page's days for one range: a month for the calendar, or the next periods of the
// phone's list. GET ?start=YYYY-MM-DD&end=YYYY-MM-DD (the user's own dates) returns
// { days, reports }: every day with sets or a note, and the reports of the periods that
// start in the range. A range is at most MAX_RANGE_DAYS long, so no request reads
// everything ever logged.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!isDate(start) || !isDate(end) || end < start) {
        return NextResponse.json({ error: 'start and end must be dates, start first' }, { status: 400 })
    }
    if (daysBetween(start, end) > MAX_RANGE_DAYS) {
        return NextResponse.json({ error: `A range is at most ${MAX_RANGE_DAYS} days` }, { status: 400 })
    }

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('timezone, language')
        .eq('user_id', user.id)
        .maybeSingle()

    const range = { start, end }
    const [language, reports] = await Promise.all([
        getEffectiveLanguage(profile?.language),
        loadReportStatuses(supabase, user.id, range),
    ])
    const days = await loadHistoryDays(supabase, {
        userId: user.id,
        range,
        timeZone: profile?.timezone ?? 'UTC',
        language,
    })

    return NextResponse.json({ days, reports })
}
