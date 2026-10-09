import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isDate } from '@/lib/history'
import { loadReports } from '@/lib/history-data'

// The 報告 tab's next page: GET ?before=YYYY-MM-DD returns { reports }, the reports of
// the periods that start before that day, newest first, a page at a time.
export async function GET(request: Request) {
    const before = new URL(request.url).searchParams.get('before')
    if (!isDate(before)) {
        return NextResponse.json({ error: 'before must be a date' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({ reports: await loadReports(supabase, user.id, before) })
}
