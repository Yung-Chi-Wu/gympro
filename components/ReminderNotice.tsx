'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { keepReminderSaved, reminderState } from '@/lib/push-client'
import { reportClientError } from '@/lib/report-client-error'
import { BUTTON } from '@/lib/ui'
import { Icon } from './Icon'

/** Where the reminder's switch is: Settings → 帳號, opened on a desktop and scrolled to on a phone */
export const REMINDER_SETTING_HREF = '/settings?section=account#group-account'

/** Set for this visit once the card is closed: it's back the next time the app opens */
const CLOSED_KEY = 'reminder_card_closed'

/**
 * A small card over Today saying the daily reminder can be turned on in Settings (owner,
 * 2026-10-30): every time the app opens until it's on, and × hides it until the next time. Only
 * where the device can get it, once the user is past onboarding. It floats over the page, not in
 * it: under the top bar on a phone, clear of Ronnie's button by the tab bar, and bottom left of
 * the page from md, clear of Ronnie's column. It doesn't ask for notifications itself; Settings
 * has the switch. A device that is on saves its subscription again once a day from here
 * (lib/push-client.ts).
 */
export function ReminderNotice({ ready }: { ready: boolean }) {
    const t = useTranslations('reminder')
    const supabase = createClient()
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!ready) return
        void reminderState().then((state) => {
            if (state === 'on') {
                keepReminderSaved(supabase).catch((err) => reportClientError('client/reminder/keep-saved', err))
                return
            }
            let closed = false
            try { closed = sessionStorage.getItem(CLOSED_KEY) === '1' } catch {}
            if (state === 'off' && !closed) setOpen(true)
        })
    }, [ready, supabase])

    function close() {
        try { sessionStorage.setItem(CLOSED_KEY, '1') } catch {}
        setOpen(false)
    }

    if (!open) return null
    return (
        <aside aria-labelledby="reminder-notice-title"
            className="fixed inset-x-4 top-[calc(60px+env(safe-area-inset-top))] z-50 mx-auto max-w-[420px] space-y-3 rounded-card border border-line bg-raised p-4 shadow-float motion-safe:animate-rise md:inset-x-auto md:top-auto md:bottom-6 md:left-22 md:mx-0 md:w-80 lg:left-64">
            <div className="flex items-start gap-3">
                <div className="flex-1 space-y-1">
                    <h2 id="reminder-notice-title" className="font-bold">{t('noticeTitle')}</h2>
                    <p className="text-[15px] text-muted md:text-sm">{t('noticeBody')}</p>
                </div>
                {/* Its tap area reaches past the icon, to the card's corner */}
                <button type="button" onClick={close} aria-label={t('close')}
                    className="-m-3 p-3 text-muted transition-colors hover:text-ink">
                    <Icon name="close" className="size-5" />
                </button>
            </div>
            <div className="flex justify-end">
                <Link href={REMINDER_SETTING_HREF} onClick={close} className={BUTTON.primary}>{t('goToSettings')}</Link>
            </div>
        </aside>
    )
}
