'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { keepReminderSaved, reminderState, turnOnReminder } from '@/lib/push-client'
import { reportClientError } from '@/lib/report-client-error'
import { BUTTON } from '@/lib/ui'

/** Set once this device has answered, either way */
export const REMINDER_ASKED_KEY = 'reminder_asked'

/**
 * The daily reminder's question, on Today the first time this device can turn it on (owner,
 * 2026-10-30): once, never again after either answer, and Settings keeps the switch. On an iPhone
 * that is in the installed app, since Safari can't get notifications. A device that is on saves its
 * subscription again once a day from here (lib/push-client.ts).
 */
export function ReminderPrompt() {
    const t = useTranslations('reminder')
    const supabase = createClient()
    const [shown, setShown] = useState<'ask' | 'on' | 'denied' | null>(null)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        void reminderState().then((state) => {
            if (state === 'on') {
                keepReminderSaved(supabase).catch((err) => reportClientError('client/reminder/keep-saved', err))
                return
            }
            let asked = true
            try { asked = localStorage.getItem(REMINDER_ASKED_KEY) === '1' } catch {}
            if (state === 'off' && !asked) setShown('ask')
        })
    }, [supabase])

    const answered = () => {
        try { localStorage.setItem(REMINDER_ASKED_KEY, '1') } catch {}
    }

    async function turnOn() {
        setBusy(true)
        setFailed(false)
        try {
            const state = await turnOnReminder(supabase)
            answered()
            setShown(state === 'on' ? 'on' : state === 'denied' ? 'denied' : null)
        } catch (err) {
            reportClientError('client/reminder/turn-on', err)
            setFailed(true)
        } finally {
            setBusy(false)
        }
    }

    if (shown === 'on' || shown === 'denied') {
        return <p role="status" className="rounded-card bg-done px-4 py-3 text-[15px] text-muted md:text-sm">{t(shown === 'on' ? 'turnedOn' : 'blocked')}</p>
    }
    if (shown !== 'ask') return null
    return (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-line bg-card px-4 py-3">
            <div className="min-w-0 flex-1 basis-56 space-y-0.5">
                <p className="text-[15px] font-semibold md:text-sm">{t('ask')}</p>
                <p className="text-[13px] text-muted md:text-xs">{t('askNote')}</p>
                {failed && <p role="alert" className="text-[13px] text-miss md:text-xs">{t('failed')}</p>}
            </div>
            <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => { answered(); setShown(null) }} className={BUTTON.secondary}>{t('noThanks')}</button>
                <button type="button" disabled={busy} onClick={turnOn} className={BUTTON.primary}>{t('turnOn')}</button>
            </div>
        </section>
    )
}
