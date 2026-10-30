'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { keepReminderSaved, REMINDER_TOLD_KEY, reminderState } from '@/lib/push-client'
import { reportClientError } from '@/lib/report-client-error'
import { BUTTON } from '@/lib/ui'

/** Where the reminder's switch is: Settings → 帳號, opened on a desktop and scrolled to on a phone */
export const REMINDER_SETTING_HREF = '/settings?section=account#group-account'

/**
 * Tells the user, once on this device, that the daily reminder can be turned on in Settings
 * (owner, 2026-10-30): a dialog over Today, not a card in it, and only where the device can get it.
 * It doesn't ask for notifications itself; Settings has the switch. Once the user is past
 * onboarding. A device that is on saves its subscription again once a day from here
 * (lib/push-client.ts).
 */
export function ReminderNotice({ ready }: { ready: boolean }) {
    const t = useTranslations('reminder')
    const supabase = createClient()
    const [open, setOpen] = useState(false)
    const settingsLink = useRef<HTMLAnchorElement>(null)

    useEffect(() => {
        if (!ready) return
        void reminderState().then((state) => {
            if (state === 'on') {
                keepReminderSaved(supabase).catch((err) => reportClientError('client/reminder/keep-saved', err))
                return
            }
            let told = true
            try { told = localStorage.getItem(REMINDER_TOLD_KEY) === '1' } catch {}
            if (state === 'off' && !told) setOpen(true)
        })
    }, [ready, supabase])

    useEffect(() => {
        if (!open) return
        settingsLink.current?.focus()
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open])

    function close() {
        try { localStorage.setItem(REMINDER_TOLD_KEY, '1') } catch {}
        setOpen(false)
    }

    if (!open) return null
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="reminder-notice-title">
            <div className="w-full max-w-sm space-y-4 rounded-sheet bg-raised p-6 shadow-float">
                <div className="space-y-1.5">
                    <h2 id="reminder-notice-title" className="text-lg font-bold">{t('noticeTitle')}</h2>
                    <p className="text-[15px] text-muted md:text-sm">{t('noticeBody')}</p>
                </div>
                <div className="flex gap-2">
                    <button type="button" onClick={close} className={`${BUTTON.secondary} flex-1`}>{t('gotIt')}</button>
                    <Link ref={settingsLink} href={REMINDER_SETTING_HREF} onClick={close} className={`${BUTTON.primary} flex-1`}>{t('goToSettings')}</Link>
                </div>
            </div>
        </div>
    )
}
