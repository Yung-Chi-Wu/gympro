'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * A sheet over the page: from the bottom on a phone, centered from md. A native modal dialog, open
 * once it is rendered: it sits over the tab bar, keeps focus inside (Tab starts at its first
 * button), closes on Escape or a tap outside and gives focus back to what had it. Its content is a
 * form that closes it (method "dialog"), so any button in it closes it, after its own onClick,
 * unless it is type="button". However it closes, onClose runs once. It is put under body, out of
 * any aria-live region around it, so a screen reader reads it once, as the dialog.
 */
export function Sheet({ labelledBy, onClose, children }: {
    labelledBy: string
    onClose: () => void
    children: React.ReactNode
}) {
    const ref = useRef<HTMLDialogElement>(null)
    useEffect(() => {
        ref.current?.showModal()
        // The sheet takes focus itself, not its first button, which would show its focus ring when
        // the sheet opens with the page
        ref.current?.focus()
    }, [])

    return createPortal(
        <dialog
            ref={ref}
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close() }}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            className="mx-0 mt-auto mb-0 w-full max-w-full overscroll-contain bg-transparent p-0 outline-none backdrop:bg-black/40 motion-safe:animate-sheet md:m-auto md:max-w-sm"
        >
            <form method="dialog" className="rounded-t-sheet bg-raised px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink md:rounded-sheet md:p-5">
                {children}
            </form>
        </dialog>,
        document.body,
    )
}
