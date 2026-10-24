'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { adoptBrowserTimeZone } from '@/app/(app)/time-zone-actions'
import { serverWrite } from '@/lib/data-version'
import { browserTimeZone, UNSET_TIME_ZONE } from '@/lib/time-zone'

// Onboarding never asked for a time zone, so a profile kept the column's default (UTC), and a
// user in Taipei had a 7 am workout counted on the day before. While the profile's zone is still
// unset, this gives it the browser's, once, and reloads the page's dates. Renders nothing.
export function TimeZoneSync({ timeZone }: { timeZone: string | null }) {
    const router = useRouter()

    useEffect(() => {
        if (timeZone && timeZone !== UNSET_TIME_ZONE) return
        const zone = browserTimeZone()
        if (!zone) return
        serverWrite(() => adoptBrowserTimeZone(zone)).then(({ adopted }) => {
            if (adopted) router.refresh()
        }, () => {
            // Tried again on the next page load
        })
    }, [timeZone, router])

    return null
}
