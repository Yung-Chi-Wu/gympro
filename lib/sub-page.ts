// A page with a list and a detail (課表: a routine, 紀錄: a day, 設定: one setting) opens
// the detail by setting a search param with the History API. Next.js keeps
// useSearchParams in step, nothing is fetched from the server, and the phone's back
// gesture closes the detail. On a phone the detail is a page of its own with a back
// button in the top bar (AppTopBar, which maps each page to its param); side by side
// with the list, the param just says which item is selected.

/** The detail param of each page that has one */
export const SUB_PAGE_PARAM: Record<string, string> = {
    '/routines': 'routine',
    '/history': 'day',
    '/settings': 'item',
}

// Marks a history entry this file pushed, so going back to the list is history.back()
type SubPageState = { gymproSubPage?: boolean } | null

export function openSubPage(param: string, value: string) {
    const url = new URL(window.location.href)
    if (url.searchParams.get(param) === value) return
    const alreadyOpen = url.searchParams.has(param)
    url.searchParams.set(param, value)
    // Moving from one item to another replaces the entry: back still goes to the list
    if (alreadyOpen) {
        const pushed = !!(window.history.state as SubPageState)?.gymproSubPage
        window.history.replaceState({ gymproSubPage: pushed }, '', url)
        return
    }
    window.history.pushState({ gymproSubPage: true }, '', url)

    // Shown instead of the list, the detail starts at its top; going back returns to the
    // place in the list the user left
    const main = document.querySelector('main')
    if (!main || main.clientWidth >= SPLIT_WIDTH) return
    const scroller = window.matchMedia('(min-width: 768px)').matches ? main : document.scrollingElement
    if (!scroller) return
    const listTop = scroller.scrollTop
    scroller.scrollTo(0, 0)
    window.addEventListener('popstate', () => restoreScroll(scroller, listTop), { once: true })
}

/** The width of <main> from which list and detail sit side by side (--container-split) */
const SPLIT_WIDTH = 640

// The list draws again after the URL changes: wait until it is tall enough to scroll back to
function restoreScroll(scroller: Element, top: number, framesLeft = 20) {
    if (scroller.scrollHeight - scroller.clientHeight >= top || framesLeft === 0) {
        scroller.scrollTo(0, top)
        return
    }
    requestAnimationFrame(() => restoreScroll(scroller, top, framesLeft - 1))
}

export function closeSubPage(param: string) {
    if ((window.history.state as SubPageState)?.gymproSubPage) {
        window.history.back()
        return
    }
    // Opened from a link or a reload: there is no list entry to go back to
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState(null, '', url)
}
