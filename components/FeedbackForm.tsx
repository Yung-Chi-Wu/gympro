'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { FEEDBACK_KINDS, MAX_FEEDBACK_CHARS, type FeedbackKind } from '@/lib/feedback'
import { reportClientError, responseError } from '@/lib/report-client-error'
import { BUTTON, SEGMENTED, TEXT_BUTTON } from '@/lib/ui'

// 意見回饋 in Settings: what kind, and what the user wants to say. Sent to POST /api/feedback,
// which keeps it in app_feedback for the owner (lib/feedback.ts), with the language the page is in.
// The kind is picked like kg / lb, and the box's hint says what to write for it. What goes with it
// is said under the box, before it is sent.

const TEXTAREA = 'w-full rounded-field border border-line bg-card px-3 py-2.5 md:py-2'

export function FeedbackForm() {
    const t = useTranslations('settings.feedback')
    const language = useLocale() === 'zh-TW' ? 'zh-TW' : 'en'
    const [kind, setKind] = useState<FeedbackKind>('idea')
    const [message, setMessage] = useState('')
    const [state, setState] = useState<'editing' | 'sending' | 'sent' | 'failed' | 'tooMany'>('editing')

    async function send(e: React.FormEvent) {
        e.preventDefault()
        if (!message.trim() || state === 'sending') return
        setState('sending')
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, message, language }),
            })
            if (res.ok) {
                setMessage('')
                setState('sent')
                return
            }
            if (res.status === 429) return setState('tooMany')
            reportClientError('client/feedback', responseError(`Feedback request failed: ${res.status}`, res.status, null))
            setState('failed')
        } catch (err) {
            reportClientError('client/feedback', err)
            setState('failed')
        }
    }

    if (state === 'sent') {
        return (
            <div className="space-y-3">
                <p role="status" className="text-[15px] font-medium text-good md:text-sm">{t('sent')}</p>
                <button type="button" onClick={() => setState('editing')} className={TEXT_BUTTON}>
                    {t('another')}
                </button>
            </div>
        )
    }

    return (
        <form onSubmit={send} className="space-y-4">
            <div role="radiogroup" aria-label={t('kindLabel')} className={`${SEGMENTED.track} md:max-w-sm`}>
                {FEEDBACK_KINDS.map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        onClick={() => setKind(k)}
                        className={`${SEGMENTED.segment} flex-1`}
                    >
                        {t(`kinds.${k}`)}
                    </button>
                ))}
            </div>
            <label className="block">
                <span className="sr-only">{t('messageLabel')}</span>
                <textarea
                    value={message}
                    onChange={(e) => { setMessage(e.target.value); if (state !== 'editing') setState('editing') }}
                    maxLength={MAX_FEEDBACK_CHARS}
                    rows={5}
                    placeholder={t(`placeholders.${kind}`)}
                    className={TEXTAREA}
                />
            </label>
            <p className="text-xs leading-relaxed text-faint">{t('note')}</p>
            {(state === 'failed' || state === 'tooMany') && (
                <p role="alert" className="text-sm text-miss">{t(state)}</p>
            )}
            <button type="submit" disabled={!message.trim() || state === 'sending'} className={BUTTON.primary}>
                {state === 'sending' ? t('sending') : t('send')}
            </button>
        </form>
    )
}
