// Where a sign-in link sends the user afterwards (?next=): only a path on this site. Joined to
// the origin as it came, next=@evil.com or next=.evil.com named another host.

// One slash, not // or /\, which name another host
const ONE_SLASH = /^\/(?!\/|\\)/

/** `next` as a path on `origin`, or /dashboard when it is missing or would leave the site */
export function safeNextPath(next: string | null, origin: string): string {
    if (next && ONE_SLASH.test(next)) {
        try {
            // The parser drops a tab or newline (/<tab>/evil.com) and resolves /a/..//evil.com,
            // so the result is checked again
            const url = new URL(next, origin)
            const path = `${url.pathname}${url.search}${url.hash}`
            if (url.origin === origin && ONE_SLASH.test(path)) return path
        } catch {
            // Not a URL at all: the dashboard, as below
        }
    }
    return '/dashboard'
}
