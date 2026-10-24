// This browser's data version: a number that goes up after every write the user makes or asks
// for, so whatever was drawn from data read earlier can tell it may be out of date and read again.
// That is "read your writes": a user always sees their own changes (Terry et al., Session
// Guarantees for Weakly Consistent Replicated Data, 1994).
//
// Writes count in two places, so no caller has to remember to:
// - every write through the browser's Supabase client (writeTrackingFetch, given to it in
//   lib/supabase/client.ts), and
// - every write the server does for the browser, through an API route or a server action, which
//   the caller wraps in serverWrite. scripts/check-data-writes.ts fails CI on one that isn't.
// The pages read it in components/ReadYourWrites.tsx.

let version = 0

export function dataVersion(): number {
    return version
}

/** Counts one write */
export function dataChanged(): void {
    version++
}

/**
 * A write the server does for the browser: an API route or a server action. It counts once it is
 * done, failed or not, as a failure may have written part of it.
 */
export async function serverWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write()
    } finally {
        dataChanged()
    }
}

/** Whether a request to Supabase writes: anything but a read of its REST API (rpc included) */
export function isDataWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    return url.pathname.startsWith('/rest/v1/') && method !== 'GET' && method !== 'HEAD'
}

/** fetch for the browser's Supabase client: a request that writes counts once it is answered, or fails */
export function writeTrackingFetch(fetchImpl?: typeof fetch): typeof fetch {
    return async (input, init) => {
        try {
            return await (fetchImpl ?? fetch)(input, init)
        } finally {
            if (isDataWrite(input, init)) dataChanged()
        }
    }
}
