// One set of class strings for buttons and segmented controls, so a screen doesn't copy its own.
// Every button is a pill. Phone sizes first (44px targets, 15px text), the denser desktop ones
// from md. The corners, colors and shadow they and the cards use are tokens in app/globals.css
// (rounded-field, rounded-card, rounded-sheet, bg-raised, shadow-float); the colors change at
// night in html.dark.
//
// A string here sets the button's display, size and colors, so a screen adds only layout
// (flex-1, w-full, shrink-0): a second class for the same property wouldn't reliably win.

const BASE =
    'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-9 md:px-4 md:text-sm'

export const BUTTON = {
    /** The screen's main action: one per screen or form */
    primary: `${BASE} bg-accent text-accent-ink hover:opacity-90`,
    /** Every other action: a tonal pill with no border */
    secondary: `${BASE} bg-done text-ink hover:bg-line`,
    /** A destructive action, before anything is lost (it asks first) */
    danger: `${BASE} bg-miss/10 text-miss hover:bg-miss/15`,
    /** The confirm of a destructive action, the step that loses it */
    dangerConfirm: `${BASE} bg-miss text-miss-ink hover:opacity-90`,
} as const

/** An action set as accent text, with a pill's touch target and focus ring */
export const TEXT_BUTTON =
    'inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-full text-[15px] font-semibold text-accent transition hover:opacity-80 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-9 md:text-sm'

/**
 * A few choices in one pill (kg / lb, calendar / routines): the track, and each segment in it.
 * The chosen segment is marked by its own ARIA state (role="radio" with aria-checked, or
 * role="tab" with aria-selected), so how it looks always matches what a screen reader says.
 * A 40px segment in the 2px-padded track keeps the 44px target.
 */
export const SEGMENTED = {
    track: 'flex rounded-full bg-done p-0.5',
    segment:
        'min-h-10 rounded-full px-4 text-[15px] font-semibold text-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-8 md:text-sm ' +
        'aria-checked:bg-raised aria-checked:text-ink aria-checked:shadow-[0_1px_1px_rgb(0_0_0/0.12)] ' +
        'aria-selected:bg-raised aria-selected:text-ink aria-selected:shadow-[0_1px_1px_rgb(0_0_0/0.12)]',
} as const
