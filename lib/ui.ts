// One set of class strings for buttons and segmented controls, so a screen doesn't copy its own.
// Every button is a pill. Phone sizes first (44px targets, 15px text), the denser desktop ones
// from md. The corners, colors and shadow they and the cards use are tokens in app/globals.css
// (rounded-field, rounded-card, rounded-sheet, bg-raised, shadow-float); the colors change at
// night in html.dark.
//
// A string here sets the button's display, size and colors, so a screen adds only layout
// (flex-1, w-full, shrink-0): a second class for the same property wouldn't reliably win.

const PILL =
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition active:scale-[0.98] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const BASE = `${PILL} min-h-11 px-5 text-[15px] md:min-h-9 md:px-4 md:text-sm`
const PRIMARY = 'bg-accent text-accent-ink hover:opacity-90'
const SECONDARY = 'bg-done text-ink hover:bg-line'

export const BUTTON = {
    /** The screen's main action: one per screen or form */
    primary: `${BASE} ${PRIMARY}`,
    /** Every other action: a tonal pill with no border */
    secondary: `${BASE} ${SECONDARY}`,
    /** A destructive action, before anything is lost (it asks first). A light tint: the red text
     * on it stays above 4.5:1 */
    danger: `${BASE} bg-miss/5 text-miss hover:bg-miss/6`,
    /** The confirm of a destructive action, the step that loses it */
    dangerConfirm: `${BASE} bg-miss text-miss-ink hover:opacity-90`,
} as const

/**
 * The same pills at their desktop size on a phone too, for a card inside a chat (a change to
 * confirm, an exercise to add), where a 44px pill outweighs the reply it belongs to. 36px is still
 * well past the 24px minimum target.
 */
export const CARD_BUTTON = {
    primary: `${PILL} min-h-9 px-4 text-sm ${PRIMARY}`,
    secondary: `${PILL} min-h-9 px-4 text-sm ${SECONDARY}`,
} as const

/** An action set as accent text, with a pill's touch target and focus ring */
export const TEXT_BUTTON =
    'inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-full text-[15px] font-semibold text-accent transition hover:opacity-80 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:min-h-9 md:text-sm'

/**
 * One of several choices set out in a row (Coach G's answers, what was wrong with a reply): a
 * tonal pill, ink once picked (aria-pressed), so a pick shows without a border or a check alone.
 * Its text color is inherited, not text-ink: the night rule for text-ink in globals.css is
 * !important and would keep a picked chip's text light on its light fill.
 */
export const CHIP =
    'inline-flex min-h-10 items-center rounded-full bg-done px-4 text-left text-sm font-medium transition hover:bg-line aria-pressed:bg-ink aria-pressed:text-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Ronnie's and Coach G's chats: the coach on a tonal fill, the user in ink, each with its corner toward who said it */
export const BUBBLE = {
    coach: 'rounded-card rounded-tl-md bg-done px-3.5 py-2.5 text-[15px] leading-relaxed text-ink md:text-sm',
    user: 'rounded-card rounded-tr-md bg-ink px-3.5 py-2.5 text-[15px] leading-relaxed text-card md:text-sm',
} as const

/** A chat's message field, a pill beside its Send */
export const CHAT_FIELD =
    'min-h-11 min-w-0 flex-1 rounded-full border border-line bg-card px-4 text-[15px] text-ink placeholder:text-muted disabled:opacity-50 md:min-h-9 md:text-sm'

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
