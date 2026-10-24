'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { dataVersion } from '@/lib/data-version'

// This browser's data version (lib/data-version.ts) when each server render of a page was shown,
// by the render's id
const shownAt = new Map<string, number>()

// A render shown before is one the browser kept in memory and shows again, on back or forward,
// without asking the server. If the user wrote anything since it was shown, the page is read
// again, so it doesn't leave out what they just saved.
export function ReadYourWritesClient({ drawing }: { drawing: string }) {
    const router = useRouter()
    useEffect(() => {
        const at = shownAt.get(drawing)
        shownAt.set(drawing, dataVersion())
        if (at !== undefined && at < dataVersion()) router.refresh()
    }, [drawing, router])
    return null
}
