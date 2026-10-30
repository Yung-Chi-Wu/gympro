// The daily reminder (owner, 2026-10-30): at 21:00 in the user's own time zone, a push notification
// asks whether they trained today, or, when they logged sets, whether anything is left to add. Not
// on a rest day the cycle plans; every day for a user without a cycle. Shared by the app, which
// subscribes this device (lib/push-client.ts), and the Lambda that sends it
// (lambda/ai-worker/src/reminders.ts).

/** The hour, in the user's time zone, the reminder goes out */
export const REMINDER_HOUR = 21

/**
 * The push services browsers subscribe with: Chrome and Android (FCM), Firefox, Safari and iOS, and
 * Edge on Windows. The Lambda posts only to these, and the database takes only these (migration
 * 20261030120000), so a subscription can't make it post anywhere else.
 */
const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[!-~]+$/
export const MAX_ENDPOINT_LENGTH = 1024

export const isPushEndpoint = (url: string) => url.length <= MAX_ENDPOINT_LENGTH && PUSH_ENDPOINT.test(url)

/** What a reminder carries, and what the service worker (public/sw.js) shows */
export interface ReminderPayload {
    title: string
    body: string
    /** Where a tap goes: Today, where the day is logged */
    url: string
    /** One reminder on screen at a time: a newer one replaces it */
    tag: string
}

export const REMINDER_TAG = 'daily-reminder'

/** The reminder's text: a question on a day with nothing logged, else what was logged and whether anything is left */
export function reminderPayload(language: string, setsToday: number): ReminderPayload {
    const zh = language === 'zh-TW'
    const body = setsToday === 0
        ? (zh ? '今天有練嗎？有的話記一下。' : 'Did you train today? If you did, log it.')
        : zh ? `今天記了 ${setsToday} 組。還有沒記到的嗎？` : `${setsToday} ${setsToday === 1 ? 'set' : 'sets'} logged today. Anything left to add?`
    return { title: 'GymPro', body, url: '/dashboard', tag: REMINDER_TAG }
}
