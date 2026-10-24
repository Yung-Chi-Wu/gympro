import { useEffect, useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

// Where a tap on a tab is going, from the tap until that page is in. The pages have no loading
// skeletons (they took at least 300 ms to give way to the page: React's minimum for a
// fallback), so the page on screen stays until the next one is ready, and the tab bars mark the
// tapped tab at once instead of when the address changes.

// The latest tap, and the addresses it can still be on its way from: where it was tapped, and
// the pages of taps it overtook (on a slow connection an overtaken page can still show for a
// moment). Any other address means the app went elsewhere (back, another link), so no mark.
let target: { href: string; from: Set<string> } | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** A tab's onNavigate: marks it as where the app is going */
export function markNavigation(href: string) {
    const here = `${location.pathname}${location.search}`
    const overtaken = target && target.from.has(here) ? [...target.from, target.href] : []
    target = { href, from: new Set([here, ...overtaken]) }
    listeners.forEach((listener) => listener())
}

/** The href a tap is going to while its page loads; null once it is in, or with no tap */
export function usePendingHref(): string | null {
    const pending = useSyncExternalStore(subscribe, () => target, () => null)
    const pathname = usePathname()
    const search = useSearchParams().toString()
    const here = search ? `${pathname}?${search}` : pathname
    // Arrived: forgotten, so going back to where it came from marks nothing
    useEffect(() => {
        if (target?.href === here) target = null
    }, [here])
    return pending && pending.href !== here && pending.from.has(here) ? pending.href : null
}

/** The path the tab bars mark: where a tap is going, else where the app is */
export function useShownPath(): string {
    const pending = usePendingHref()
    const pathname = usePathname()
    return pending ? pending.split('?')[0] : pathname
}
