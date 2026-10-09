import type { ReactNode } from 'react'

// Line icons for the app shell and pages, drawn on a 24×24 grid with the stroke in the
// text color, as in the layout mockup. They are decorative: the text or aria-label next
// to them says what they do.

const PATHS = {
    today: <><path d="M4 10.5 12 4l8 6.5V20H4z" /><path d="M9.5 20v-5.5h5V20" /></>,
    routines: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4v2h6V4M8.5 11h7M8.5 15h5" /></>,
    history: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16M8.5 3v4M15.5 3v4" /><circle cx="9" cy="14" r="1.1" /><circle cx="14" cy="14" r="1.1" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
    chat: <><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 5 13.5z" /><path d="M9 9.5h6M9 12.5h4" /></>,
    back: <path d="M14.5 6 8.5 12l6 6" />,
    forward: <path d="M9.5 6l6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
    out: <path d="M14 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h9" />,
    grip: <><circle cx="9" cy="7" r="1" /><circle cx="15" cy="7" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="17" r="1" /><circle cx="15" cy="17" r="1" /></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`} fill="none"
            stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            {PATHS[name]}
        </svg>
    )
}
