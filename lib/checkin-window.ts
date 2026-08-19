export interface WindowResult {
    isOpen: boolean
    periodStart: string | null
    periodEnd: string | null
    closedMessage?: string
}

export function computeRegularCheckInWindow(timeZone: string): WindowResult {
    const { weekday, hour, dateStr } = getLocalDateTimeParts(timeZone)

    if (weekday === 0 && hour >= 21) {
        const periodStart = mostRecentMonday(dateStr)
        return { isOpen: true, periodStart, periodEnd: dateStr }
    }
    if (weekday === 1) {
        const thisMonday = mostRecentMonday(dateStr)
        const periodStart = addDays(thisMonday, -7)
        const periodEnd = addDays(periodStart, 6)
        return { isOpen: true, periodStart, periodEnd }
    }
    return {
        isOpen: false,
        periodStart: null,
        periodEnd: null,
        closedMessage: 'Check-in opens Sunday at 9pm and stays open through Monday.',
    }
}

export function computeProCheckInWindow(
    timeZone: string,
    cycleLength: number,
    startDate: string
): WindowResult {
    const { hour, dateStr } = getLocalDateTimeParts(timeZone)
    const daysSinceStart = daysBetween(startDate, dateStr)
    const dayIndex = (((daysSinceStart % cycleLength) + cycleLength) % cycleLength) + 1

    if (dayIndex === cycleLength && hour >= 21) {
        const periodStart = addDays(startDate, daysSinceStart - (cycleLength - 1))
        const periodEnd = addDays(periodStart, cycleLength - 1)
        return { isOpen: true, periodStart, periodEnd }
    }
    if (dayIndex === 1 && daysSinceStart >= cycleLength) {
        const periodStart = addDays(startDate, daysSinceStart - cycleLength)
        const periodEnd = addDays(periodStart, cycleLength - 1)
        return { isOpen: true, periodStart, periodEnd }
    }
    return {
        isOpen: false,
        periodStart: null,
        periodEnd: null,
        closedMessage: `Check-in opens at 9pm on day ${cycleLength} of your cycle.`,
    }
}

// ---------- Timezone-aware date helpers ----------

function getLocalDateTimeParts(
    timeZone: string
): { weekday: number; hour: number; dateStr: string } {
    const weekdayIndex: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        hour12: false,
    })

    const parts: Record<string, string> = {}
    for (const part of formatter.formatToParts(new Date())) {
        parts[part.type] = part.value
    }

    return {
        weekday: weekdayIndex[parts.weekday],
        hour: Number(parts.hour === '24' ? '0' : parts.hour),
        dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    }
}

function daysBetween(startDateIso: string, todayIso: string): number {
    const start = new Date(`${startDateIso}T00:00:00Z`)
    const today = new Date(`${todayIso}T00:00:00Z`)
    return Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

function addDays(dateIso: string, days: number): string {
    const date = new Date(`${dateIso}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().split('T')[0]
}

function mostRecentMonday(dateIso: string): string {
    const date = new Date(`${dateIso}T12:00:00Z`)
    const day = date.getUTCDay()
    const diff = day === 0 ? -6 : 1 - day
    date.setUTCDate(date.getUTCDate() + diff)
    return date.toISOString().split('T')[0]
}