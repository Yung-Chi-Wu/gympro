import { useEffect, useState, type KeyboardEvent } from 'react'

// Enter while an IME is composing (注音, 拼音) picks the characters; it isn't a submit.
// Treated as one, the text was sent and the IME then wrote it back into the box.
// Safari marks that keydown with keyCode 229 instead of isComposing.
export const isSubmitEnter = (e: KeyboardEvent) =>
    e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229

/**
 * Whether the phone's on-screen keyboard is open: the visible viewport has shrunk by more
 * than a keyboard's height since the page loaded. The tab bar and Ronnie's button hide
 * then, so they don't ride up on top of the keyboard and cover what is being typed.
 */
export function useKeyboardOpen(): boolean {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const initialHeight = vv.height
        const handleResize = () => setOpen(initialHeight - vv.height > 150)
        vv.addEventListener('resize', handleResize)
        return () => vv.removeEventListener('resize', handleResize)
    }, [])

    return open
}

export interface VisibleViewport {
    /** The visible height, without the on-screen keyboard */
    height: number
    /** How far the visible area is scrolled down the page's own viewport (iOS moves it to show a focused input) */
    offsetTop: number
    keyboardOpen: boolean
}

/**
 * The part of the screen the user can see, kept up to date while the on-screen keyboard
 * opens and closes and iOS scrolls to a focused input. Null until the browser reports it.
 */
export function useVisibleViewport(): VisibleViewport | null {
    const [box, setBox] = useState<VisibleViewport | null>(null)

    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const initialHeight = vv.height
        const update = () => setBox({ height: vv.height, offsetTop: vv.offsetTop, keyboardOpen: initialHeight - vv.height > 150 })
        vv.addEventListener('resize', update)
        vv.addEventListener('scroll', update)
        // Measure once now, from a frame callback rather than the effect itself
        const frame = requestAnimationFrame(update)
        return () => {
            cancelAnimationFrame(frame)
            vv.removeEventListener('resize', update)
            vv.removeEventListener('scroll', update)
        }
    }, [])

    return box
}
