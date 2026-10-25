import type { HistoryRange } from './history'

// How 紀錄 and 課表's calendar write a date, a range and a month. Dates are the user's own
// YYYY-MM-DD; each is read at noon UTC and written in UTC, so it is the same on the server
// and in any browser.

const noonUtc = (date: string) => new Date(`${date}T12:00:00Z`)

/** 10/8 週四, or Thu, Oct 8 */
export function formatDay(date: string, language: string): string {
    const d = noonUtc(date)
    if (language !== 'zh-TW') {
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    }
    const weekday = d.toLocaleDateString('zh-TW', { weekday: 'short', timeZone: 'UTC' })
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${weekday}`
}

/** 10/5–10/11 */
export const formatRange = ({ start, end }: HistoryRange) =>
    `${Number(start.slice(5, 7))}/${Number(start.slice(8))}–${Number(end.slice(5, 7))}/${Number(end.slice(8))}`

/** 2026 年 10 月, or October 2026 */
export function formatMonth(month: string, language: string): string {
    const [y, m] = month.split('-').map(Number)
    if (language === 'zh-TW') return `${y} 年 ${m} 月`
    return noonUtc(`${month}-01`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** M T W T F S S, or 一 二 三 四 五 六 日: Monday first */
export function weekdayLetters(language: string): string[] {
    // 2024-01-01 was a Monday
    return Array.from({ length: 7 }, (_, i) => noonUtc(`2024-01-0${i + 1}`)
        .toLocaleDateString(language === 'zh-TW' ? 'zh-TW' : 'en-US', { weekday: 'narrow', timeZone: 'UTC' }))
}
