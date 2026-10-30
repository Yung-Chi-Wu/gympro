// The daily reminder (owner, 2026-10-30): at 21:00 in the user's own time zone, a push notification
// asks whether they trained today, the same words whether or not the day is logged. Not on a rest
// day the cycle plans; every day for a user without a cycle. Shared by the app, which
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
    /** The question itself. The phone names the sender under it ("from GymPro" on an iPhone, the
     * site on Android and desktops), so the app's name isn't the title */
    title: string
    /** Empty: the title is the whole message */
    body: string
    /** Where a tap goes: Today, where the day is logged */
    url: string
    /** One reminder on screen at a time: a newer one replaces it */
    tag: string
}

export const REMINDER_TAG = 'daily-reminder'

/** The reminder's text, one question every day (owner, 2026-10-30) */
export function reminderPayload(language: string): ReminderPayload {
    return { title: language === 'zh-TW' ? '今天訓練了嗎？' : 'Did you train today?', body: '', url: '/dashboard', tag: REMINDER_TAG }
}
