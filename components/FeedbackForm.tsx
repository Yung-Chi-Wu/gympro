'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { FEEDBACK_KINDS, MAX_FEEDBACK_CHARS, type FeedbackKind } from '@/lib/feedback'
import { reportClientError, responseError } from '@/lib/report-client-error'

// 意見回饋 in Settings: what kind, and what the user wants to say. Sent to POST /api/feedback,
// which keeps it in app_feedback for the owner (lib/feedback.ts), with the language the page is in.
// The kind is picked like kg / lb, and the box's hint says what to write for it. What goes with it
// is said under the box, before it is sent.

const TEXTAREA = 'w-full rounded-[9px] border border-line bg-card px-3 py-2.5 md:py-2'
const PRIMARY = 'inline-flex min-h-11 items-center justify-center rounded-[9px] bg-accent px-5 text-[15px] font-bold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50 md:min-h-10 md:text-sm'

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
                <button type="button" onClick={() => setState('editing')} className="text-[15px] font-medium text-accent md:text-sm">
                    {t('another')}
                </button>
            </div>
        )
    }

    return (
        <form onSubmit={send} className="space-y-4">
            <div role="radiogroup" aria-label={t('kindLabel')} className="flex overflow-hidden rounded-[9px] border border-line md:max-w-sm">
                {FEEDBACK_KINDS.map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        onClick={() => setKind(k)}
                        className={`min-h-11 flex-1 px-2 text-[15px] font-bold md:min-h-10 md:text-sm ${kind === k ? 'bg-ink text-card' : 'text-faint'}`}
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
            <button type="submit" disabled={!message.trim() || state === 'sending'} className={PRIMARY}>
                {state === 'sending' ? t('sending') : t('send')}
            </button>
        </form>
    )
}
