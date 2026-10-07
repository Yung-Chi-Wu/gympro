import type { KeyboardEvent } from 'react'

// Enter while an IME is composing (注音, 拼音) picks the characters; it isn't a submit.
// Treated as one, the text was sent and the IME then wrote it back into the box.
// Safari marks that keydown with keyCode 229 instead of isComposing.
export const isSubmitEnter = (e: KeyboardEvent) =>
    e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229
