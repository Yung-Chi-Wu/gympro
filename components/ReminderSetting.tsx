'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { reminderState, turnOffReminder, turnOnReminder, type ReminderState } from '@/lib/push-client'
import { reportClientError } from '@/lib/report-client-error'
import { SEGMENTED } from '@/lib/ui'
import { REMINDER_ASKED_KEY } from './ReminderPrompt'

/**
 * The daily reminder on this device, in Settings → 帳號: 開 or 關, saved at once. Where it can't be
 * on, one line says why: the iPhone browser (add it to the home screen), notifications blocked, or
 * no web push.
 */
export function ReminderSetting() {
    const t = useTranslations('reminder')
    const supabase = createClient()
    const [state, setState] = useState<ReminderState | null>(null)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        void reminderState().then(setState)
    }, [])

    async function choose(on: boolean) {
        if (busy || (state === 'on') === on) return
        setBusy(true)
        setFailed(false)
        try {
            if (on) {
                setState(await turnOnReminder(supabase))
            } else {
                await turnOffReminder(supabase)
                setState('off')
            }
            // Answered here, so Today doesn't ask
            try { localStorage.setItem(REMINDER_ASKED_KEY, '1') } catch {}
        } catch (err) {
            reportClientError(on ? 'client/reminder/turn-on' : 'client/reminder/turn-off', err)
            setFailed(true)
            setState(await reminderState())
        } finally {
            setBusy(false)
        }
    }

    const note = state === 'on' ? t('onNote') : state === 'install' || state === 'denied' || state === 'unsupported' ? t(state) : null
    return (
        <div className="py-2.5">
            <div className="flex min-h-11 items-center gap-3">
                <span className="flex-1">{t('setting')}</span>
                {(state === 'on' || state === 'off') && (
                    <div role="radiogroup" aria-label={t('setting')} className={SEGMENTED.track}>
                        {[true, false].map((on) => (
                            <button key={String(on)} type="button" role="radio" aria-checked={(state === 'on') === on} disabled={busy}
                                onClick={() => choose(on)} className={SEGMENTED.segment}>
                                {t(on ? 'on' : 'off')}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {note && <p className="text-[13px] text-muted md:text-xs">{note}</p>}
            {failed && <p role="alert" className="text-[13px] text-miss md:text-xs">{t('failed')}</p>}
        </div>
    )
}
