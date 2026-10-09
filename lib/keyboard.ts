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
