// Time-zone helpers for Ronnie, moved from app/api/ai/coach/route.ts

export function localDateStr(date: Date, timeZone: string): string {
    return date.toLocaleDateString('en-CA', { timeZone })
}

export function localDateToUtcRange(dateStr: string, timeZone: string): { start: string; end: string } {
    const testDate = new Date(`${dateStr}T12:00:00Z`)
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    })
    const parts = formatter.formatToParts(testDate)
    const p: Record<string, string> = {}
    parts.forEach(({ type, value }) => { p[type] = value })
    const tzOffset = testDate.getTime() - new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`).getTime()

    return {
        start: new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + tzOffset).toISOString(),
        end: new Date(new Date(`${dateStr}T23:59:59Z`).getTime() + tzOffset).toISOString(),
    }
}

export interface DateGuide {
    today: string
    weekday: string
    yesterday: string
    thisWeek: [string, string]
    lastWeek: [string, string]
    thisMonth: [string, string]
    lastMonth: [string, string]
}

/**
 * The relative dates Ronnie needs, computed in code (weeks run Monday to
 * Sunday). The eval found the model reading "last week" as the past 7 days.
 */
export function dateGuide(now: Date, timeZone: string): DateGuide {
    const today = localDateStr(now, timeZone)
    const shift = (iso: string, days: number) => {
        const d = new Date(`${iso}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + days)
        return d.toISOString().slice(0, 10)
    }
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay() // 0 = Sunday
    const monday = shift(today, dow === 0 ? -6 : 1 - dow)
    const [y, m] = today.split('-').map(Number)
    const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`
    const nextMonth = m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1)
    const thisMonthStart = monthStart(y, m)
    const lastMonthStart = m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1)
    return {
        today,
        weekday: new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        yesterday: shift(today, -1),
        thisWeek: [monday, shift(monday, 6)],
        lastWeek: [shift(monday, -7), shift(monday, -1)],
        thisMonth: [thisMonthStart, shift(nextMonth, -1)],
        lastMonth: [lastMonthStart, shift(thisMonthStart, -1)],
    }
}
