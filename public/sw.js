// GymPro's service worker: it shows the daily reminder (lib/push.ts) and opens the app when the
// reminder is tapped. It caches nothing, so the app loads as it does without one. Registered only on
// a device that turns the reminder on (lib/push-client.ts).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
    let data = {}
    try {
        data = event.data ? event.data.json() : {}
    } catch {
        // Shown anyway: iOS ends a subscription whose push shows nothing
    }
    // A path in the app only: a push can't send a tap anywhere else
    const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/dashboard'
    event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title : 'GymPro', {
        body: typeof data.body === 'string' ? data.body : '',
        icon: '/icon-192.png',
        tag: typeof data.tag === 'string' ? data.tag : 'daily-reminder',
        data: { url },
    }))
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const url = new URL(event.notification.data?.url ?? '/dashboard', self.location.origin).href
    event.waitUntil((async () => {
        // The app already open comes to the front, on Today; otherwise it opens there
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
        if (open) {
            await open.focus()
            return open.navigate(url)
        }
        return self.clients.openWindow(url)
    })())
})
