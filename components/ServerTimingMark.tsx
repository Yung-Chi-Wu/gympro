import { timingSummary } from '@/lib/server-timing'

// A page's server steps (lib/server-timing.ts). React renders what a page returns once the page's
// reads are done, so they are all in. A <template> shows nothing and takes no space; a page puts
// it first, as space-y spaces every child but the last.
export function ServerTimingMark() {
    return <template data-server-timing={timingSummary()} />
}
