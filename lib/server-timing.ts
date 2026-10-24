import { cache } from 'react'

// Where a page's server time goes, read off the page itself, in devtools and by the speed checks.
// The proxy sends its part as a Server-Timing header (proxy.ts). A server component can't set
// headers, so a page lists its own steps in a hidden element (components/ServerTimingMark.tsx). Each step has its start and its length, in ms from the
// request's first step: every Supabase request the server's client makes (lib/supabase/server.ts)
// and the token check (lib/frame-profile.ts).

interface Step {
    name: string
    start: number
    ms: number
}

// When this server instance loaded the module: a page that shows "up 0s" came with a cold start
const loadedAt = performance.now()

// One list per request: React's cache gives each server render its own. Outside a render (a
// route handler or a server action) each call makes a new list, and its steps go nowhere.
const requestTiming = cache(() => ({ origin: performance.now(), steps: [] as Step[] }))

/** Runs one awaited step of the request and records how long it took */
export async function timed<T>(name: string, work: () => PromiseLike<T>): Promise<T> {
    const timing = requestTiming()
    const start = performance.now()
    try {
        return await work()
    } finally {
        timing.steps.push({ name, start: start - timing.origin, ms: performance.now() - start })
    }
}

/** fetch for the server's Supabase clients: each request is a step, named by what it reads */
export const timedFetch: typeof fetch = (input, init) => timed(stepName(input, init), () => fetch(input, init))

// /rest/v1/user_profiles?select=… is user_profiles, /auth/v1/.well-known/jwks.json is
// auth/jwks.json; a write has its method in front
function stepName(input: RequestInfo | URL, init?: RequestInit): string {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const path = url.pathname.replace(/^\/rest\/v1\//, '').replace(/^\/auth\/v1\/(\.well-known\/)?/, 'auth/')
    return method === 'GET' ? path : `${method} ${path}`
}

/** The request's steps so far: "iad1, up 812s, auth 0+1, user_profiles 1+14, …, rendered 33" */
export function timingSummary(): string {
    const { origin, steps } = requestTiming()
    const now = performance.now()
    return [
        process.env.VERCEL_REGION ?? 'local',
        `up ${Math.round((now - loadedAt) / 1000)}s`,
        ...steps.map((s) => `${s.name} ${Math.round(s.start)}+${Math.round(s.ms)}`),
        `rendered ${Math.round(now - origin)}`,
    ].join(', ')
}
