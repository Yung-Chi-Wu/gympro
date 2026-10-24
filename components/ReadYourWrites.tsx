import { ReadYourWritesClient } from './ReadYourWritesClient'

// Every signed-in page renders this, so a page never shows data from before the user's own last
// write (lib/data-version.ts). Each server render gets its own id: the browser can then tell a
// page it has just been sent from one it kept in memory and shows again on back or forward.
// scripts/check-data-writes.ts fails CI on a page without it.
export function ReadYourWrites() {
    return <ReadYourWritesClient drawing={crypto.randomUUID()} />
}
