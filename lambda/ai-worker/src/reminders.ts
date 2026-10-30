import { createECDH } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import webpush, { WebPushError } from 'web-push'
import { getSupabaseClient } from './supabase'
import { getSecret } from './secrets'
import { fetchSchedule } from './report/fetch'
import { localDate } from '../../../lib/periods'
import { timeZoneOf } from '../../../lib/time-zone'
import { isPushEndpoint, REMINDER_HOUR, REMINDER_TAG, reminderPayload, type ReminderPayload } from '../../../lib/push'

// Runs every hour on the hour from EventBridge Scheduler. For each user with a device that turned
// the reminder on (push_subscriptions) whose local time is 21:00 to 21:59, it sends the daily
// reminder (lib/push.ts), except on a rest day their cycle plans. Each device is claimed for the day
// before it is sent to (reminded_on), so a
// run that repeats sends nothing twice. A device the push service no longer knows (404, 410) is
// deleted. The model is never called.
//
// { "userId": "..." } sends to that user's devices at once, whatever the time or the day, and marks
// nothing: the owner's way to see it work on a phone (aws lambda invoke).

/** The app's address, which push services may contact about the sender (VAPID's subject) */
const VAPID_SUBJECT = 'https://gympro.chichi.mom'
/** A reminder about today that isn't delivered within 3 hours (the phone was off) isn't shown at all */
const TTL_SECONDS = 3 * 3600

interface ProfileRow {
    user_id: string
    timezone: string | null
    language: string | null
}

interface SubscriptionRow {
    endpoint: string
    p256dh: string
    auth: string
}

/** A user whose reminder is due this hour, and their local date */
export interface DueReminder {
    userId: string
    language: string
    today: string
}

/** The hour (0-23) in a time zone */
export function localHour(timeZone: string, now: Date): number {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now))
}

/** The users whose local time is in the reminder's hour. A bad time zone on one profile skips only that user. */
export function dueReminders(profiles: ProfileRow[], now: Date): DueReminder[] {
    return profiles.flatMap((p) => {
        try {
            const timeZone = timeZoneOf(p.timezone)
            if (localHour(timeZone, now) !== REMINDER_HOUR) return []
            return [{ userId: p.user_id, language: p.language === 'zh-TW' ? 'zh-TW' : 'en', today: localDate(timeZone, now) }]
        } catch (err) {
            console.error(`Skipping the reminder for user ${p.user_id}: ${err instanceof Error ? err.message : String(err)}`)
            return []
        }
    })
}

/** The VAPID public key, from the private one: one secret, and nothing to keep in step with it */
export function vapidPublicKeyOf(privateKey: string): string {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'))
    return ecdh.getPublicKey().toString('base64url')
}

type SendResult = 'sent' | 'gone' | 'failed'

async function send(supabase: SupabaseClient, sub: SubscriptionRow, payload: ReminderPayload, privateKey: string): Promise<SendResult> {
    // The database takes no other endpoint; this keeps a row from before its check from being posted to
    if (!isPushEndpoint(sub.endpoint)) {
        console.error('Not sending to an endpoint that is no push service')
        return 'failed'
    }
    const host = new URL(sub.endpoint).host
    try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
            vapidDetails: { subject: VAPID_SUBJECT, publicKey: vapidPublicKeyOf(privateKey), privateKey },
            TTL: TTL_SECONDS,
            urgency: 'normal',
            // An undelivered reminder is replaced by the next, not queued behind it
            topic: REMINDER_TAG,
        })
        return 'sent'
    } catch (err) {
        const status = err instanceof WebPushError ? err.statusCode : null
        // The user turned notifications off or removed the app: the device is gone
        if (status === 404 || status === 410) {
            const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            if (error) console.error(`A gone device was not deleted: ${error.message}`)
            return 'gone'
        }
        // The push service is busy or down: not ours to fix, and tomorrow's goes out as usual
        if (status === 429 || (status != null && status >= 500)) {
            console.warn(`Reminder not delivered by ${host}: ${status}`)
            return 'failed'
        }
        // Anything else is ours: a key that doesn't match the app's, a payload too big
        console.error(`Reminder refused by ${host}: ${status ?? (err instanceof Error ? err.message : String(err))}`)
        return 'failed'
    }
}

/** Every user with a device that turned the reminder on, with their time zone and language */
async function profilesWithDevices(supabase: SupabaseClient): Promise<ProfileRow[]> {
    const ids = new Set<string>()
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('push_subscriptions').select('user_id').order('endpoint').range(from, from + 999)
        if (error) throw new Error(`Failed to read devices: ${error.message}`)
        for (const r of data ?? []) ids.add(r.user_id as string)
        if ((data?.length ?? 0) < 1000) break
    }
    if (ids.size === 0) return []
    const { data, error } = await supabase.from('user_profiles').select('user_id, timezone, language').in('user_id', [...ids])
    if (error) throw new Error(`Failed to read profiles: ${error.message}`)
    return (data ?? []) as ProfileRow[]
}

export async function handler(event?: { userId?: unknown }): Promise<void> {
    const keyParam = process.env.VAPID_PRIVATE_KEY_PARAM
    if (!keyParam) throw new Error('VAPID_PRIVATE_KEY_PARAM environment variable is not set')
    const [supabase, privateKey] = await Promise.all([getSupabaseClient(), getSecret(keyParam)])

    // The owner's test: this user's devices, now
    if (typeof event?.userId === 'string') {
        const { data: profile } = await supabase.from('user_profiles').select('language').eq('user_id', event.userId).maybeSingle()
        const { data: subs, error } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', event.userId)
        if (error) throw new Error(`Failed to read devices: ${error.message}`)
        const payload = reminderPayload(profile?.language ?? 'en')
        const results = await Promise.all((subs ?? []).map((s) => send(supabase, s as SubscriptionRow, payload, privateKey)))
        console.log(JSON.stringify({ event: 'reminder_test', devices: results.length, results }))
        return
    }

    const due = dueReminders(await profilesWithDevices(supabase), new Date())
    const counts = { due: due.length, restDay: 0, sent: 0, gone: 0, failed: 0, users: 0 }
    for (const user of due) {
        try {
            // A rest day the cycle plans (or the user made one) gets none; a user without a cycle gets one every day
            const schedule = await fetchSchedule(supabase, user.userId, user.today, 1)
            if (schedule && !schedule[0].routine) {
                counts.restDay++
                continue
            }
            const payload = reminderPayload(user.language)
            // Claimed for today before sending, so a repeated run sends nothing twice
            const { data: claimed, error } = await supabase
                .from('push_subscriptions')
                .update({ reminded_on: user.today })
                .eq('user_id', user.userId)
                .or(`reminded_on.is.null,reminded_on.lt.${user.today}`)
                .select('endpoint, p256dh, auth')
            if (error) throw new Error(`Failed to claim devices: ${error.message}`)
            if (!claimed?.length) continue
            counts.users++
            for (const r of await Promise.all((claimed as SubscriptionRow[]).map((s) => send(supabase, s, payload, privateKey)))) counts[r]++
        } catch (err) {
            // One user's failure must not stop everyone else's reminder
            console.error(`Reminder failed for user ${user.userId}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    console.log(JSON.stringify({ event: 'reminder_run', ...counts }))
}
