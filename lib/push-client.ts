import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { currentBrowserEnv } from './browser-env'

// This device and the daily reminder (lib/push.ts): whether it can get it, and turning it on and
// off. On turns on the browser's notifications, registers the service worker (public/sw.js),
// subscribes with the app's VAPID key and saves the subscription (save_push_subscription). A
// browser can replace a subscription without saying so, so an "on" device saves it again once a day.

/**
 * What this device can do about the reminder:
 * - unsupported: the browser has no web push, or the app has no key (NEXT_PUBLIC_VAPID_PUBLIC_KEY)
 * - install: an iPhone or iPad in the browser, where web push needs the app on the home screen
 * - denied: notifications are blocked for the app, which only the device's settings undo
 * - off / on
 */
export type ReminderState = 'unsupported' | 'install' | 'denied' | 'off' | 'on'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
/** The local date this device last saved its subscription */
const SAVED_ON_KEY = 'reminder_saved_on'
/** Set once this device has been told where to turn the reminder on, or has used the switch (components/ReminderNotice.tsx) */
export const REMINDER_TOLD_KEY = 'reminder_told'

type Client = SupabaseClient<Database>

const today = () => new Date().toLocaleDateString('en-CA')

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
    const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

async function currentSubscription(): Promise<PushSubscription | null> {
    if (!('serviceWorker' in navigator)) return null
    const registration = await navigator.serviceWorker.getRegistration('/')
    return (await registration?.pushManager.getSubscription()) ?? null
}

export async function reminderState(): Promise<ReminderState> {
    if (!VAPID_PUBLIC_KEY) return 'unsupported'
    const env = currentBrowserEnv()
    if (env === 'ios_safari' || env === 'ios_other') return 'install'
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
    if (Notification.permission === 'denied') return 'denied'
    return Notification.permission === 'granted' && (await currentSubscription()) ? 'on' : 'off'
}

async function save(supabase: Client, subscription: PushSubscription) {
    const { endpoint, keys } = subscription.toJSON()
    const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: endpoint ?? '', p_p256dh: keys?.p256dh ?? '', p_auth: keys?.auth ?? '' })
    if (error) throw error
    try { localStorage.setItem(SAVED_ON_KEY, today()) } catch {}
}

/** Asks for notifications (call it straight from a tap: browsers allow the question only then), then subscribes this device */
export async function turnOnReminder(supabase: Client): Promise<ReminderState> {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    await navigator.serviceWorker.ready
    const options = { userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY!) }
    let subscription = await registration.pushManager.getSubscription()
    try {
        subscription ??= await registration.pushManager.subscribe(options)
    } catch {
        // One made with an older key is in the way: replace it
        await subscription?.unsubscribe()
        subscription = await registration.pushManager.subscribe(options)
    }
    await save(supabase, subscription)
    return 'on'
}

/** Stops the reminder on this device: its row first, while signed in, then the browser's subscription */
export async function turnOffReminder(supabase: Client): Promise<void> {
    const subscription = await currentSubscription()
    if (!subscription) return
    const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: subscription.endpoint })
    // Unsubscribed whatever the answer: a row left behind is deleted when its push service says it's gone
    await subscription.unsubscribe()
    try { localStorage.removeItem(SAVED_ON_KEY) } catch {}
    if (error) throw error
}

/** On a device that is on, saves the subscription again once a day, in case the browser replaced it */
export async function keepReminderSaved(supabase: Client): Promise<void> {
    try {
        if (localStorage.getItem(SAVED_ON_KEY) === today()) return
    } catch {
        return
    }
    const subscription = await currentSubscription()
    if (subscription) await save(supabase, subscription)
}
