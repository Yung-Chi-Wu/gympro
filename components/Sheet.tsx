'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

// Nothing to subscribe to: only whether this render is in the browser
const subscribeNothing = () => () => {}

/**
 * A sheet over the page: from the bottom on a phone, centered from md; or, centered, a popup in the
 * middle of the screen at every width, for what is worth stopping for; or tall, a window most of
 * the screen's height whose content lays itself out (Coach G's chat). A native modal dialog, open
 * once it is rendered: it sits over the tab bar, keeps focus inside (Tab starts at its first
 * button), closes on Escape or a tap outside and gives focus back to what had it. Its content is a
 * form that closes it (method "dialog"), so any button in it closes it, after its own onClick,
 * unless it is type="button". However it closes, onClose runs once. It is put under body, out of
 * any aria-live region around it, so a screen reader reads it once, as the dialog.
 *
 * One that isn't dismissable, where closing it by mistake loses what was chosen or said (the first
 * onboarding, Coach G's chat; owner, 2026-11-04), closes only by its own buttons, which unmount
 * it: Escape and a tap outside do nothing, and its content is no form, since Enter in a form's one
 * text field submits the form, which would close it. Chrome closes a dialog on a second Escape
 * with no tap in between whatever the page says, so it opens again at once.
 *
 * It opens in the browser only: a page can render one open from the start (Coach G from 今天's
 * link), and on the server there is no document to put it under.
 */
export function Sheet({ labelledBy, onClose, centered = false, tall = false, dismissable = true, children }: {
    labelledBy: string
    /** Not called for a sheet that isn't dismissable: its own buttons close it */
    onClose?: () => void
    centered?: boolean
    tall?: boolean
    dismissable?: boolean
    children: React.ReactNode
}) {
    const ref = useRef<HTMLDialogElement>(null)
    const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false)
    useEffect(() => {
        if (!inBrowser) return
        ref.current?.showModal()
        // The sheet takes focus itself, not its first button, which would show its focus ring when
        // the sheet opens with the page
        ref.current?.focus()
    }, [inBrowser])
    if (!inBrowser) return null

    const popup = centered || tall
    const Body = dismissable ? 'form' : 'div'
    return createPortal(
        <dialog
            ref={ref}
            onCancel={(e) => { if (!dismissable) e.preventDefault() }}
            onClose={(e) => {
                if (dismissable) onClose?.()
                else if (e.currentTarget.isConnected) e.currentTarget.showModal()
            }}
            onClick={(e) => { if (dismissable && e.target === e.currentTarget) e.currentTarget.close() }}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            className={popup
                ? `m-auto w-[calc(100%-2rem)] ${tall ? 'max-w-lg' : 'max-w-[420px]'} overscroll-contain bg-transparent p-0 outline-none backdrop:bg-black/50 motion-safe:animate-popup`
                : 'mx-0 mt-auto mb-0 w-full max-w-full overscroll-contain bg-transparent p-0 outline-none backdrop:bg-black/40 motion-safe:animate-sheet md:m-auto md:max-w-sm'}
        >
            <Body {...(dismissable ? { method: 'dialog' } : {})} className={tall
                ? 'flex h-[85vh] flex-col overflow-hidden rounded-sheet bg-raised text-ink'
                : centered
                    ? 'rounded-sheet bg-raised p-5 text-ink'
                    : 'rounded-t-sheet bg-raised px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink md:rounded-sheet md:p-5'}>
                {children}
            </Body>
        </dialog>,
        document.body,
    )
}
