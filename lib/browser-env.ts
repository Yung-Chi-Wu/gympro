// Where GymPro is open, for the add-to-home-screen guide. It is written for iPhone users (the
// owner, 2026-10-13): there only Safari, and since iOS 16.4 the other browsers, can add a page to
// the home screen. An app's own browser can't (LINE, where most links reach Taiwan users, and
// Instagram or Facebook), and Google refuses to sign anyone in from one. The guide used to give
// the Safari steps to everyone, in LINE too.

export type BrowserEnv =
    /** Opened from the home screen: nothing to do */
    | 'installed'
    /** LINE's in-app browser, which LINE can be asked to leave (externalBrowserUrl) */
    | 'line'
    /** Another app's in-app browser: Instagram, Facebook, Messenger, the Google app... */
    | 'in_app'
    | 'ios_safari'
    /** Chrome, Edge, Firefox or Opera on iOS: they add from their own Share menu */
    | 'ios_other'
    /** Anything else (Android, a computer) */
    | 'other'

export function browserEnv(userAgent: string, { standalone = false, touchMac = false }: {
    /** display-mode standalone, or Safari's navigator.standalone */
    standalone?: boolean
    /** An iPad, which asks for desktop sites and so reports itself as a Mac with touch */
    touchMac?: boolean
} = {}): BrowserEnv {
    if (standalone) return 'installed'
    if (/\bLine\//i.test(userAgent)) return 'line'
    if (/FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|KAKAOTALK|\bGSA\//i.test(userAgent)) return 'in_app'
    if (!/iPhone|iPad|iPod/i.test(userAgent) && !touchMac) return 'other'
    return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(userAgent) ? 'ios_other' : 'ios_safari'
}

/** The browser this page is open in, read on the client; null on the server */
export function currentBrowserEnv(): BrowserEnv | null {
    if (typeof window === 'undefined') return null
    const nav = navigator as Navigator & { standalone?: boolean }
    return browserEnv(nav.userAgent, {
        standalone: window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
        touchMac: nav.platform === 'MacIntel' && nav.maxTouchPoints > 1,
    })
}

/** A page's address with LINE's parameter for opening it in the phone's own browser instead */
export function externalBrowserUrl(href: string): string {
    const url = new URL(href)
    url.searchParams.set('openExternalBrowser', '1')
    return url.toString()
}
