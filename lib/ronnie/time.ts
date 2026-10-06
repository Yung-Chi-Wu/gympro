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
