'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ForgotPasswordFormProps {
    locale: string
}

export function ForgotPasswordForm({ locale }: ForgotPasswordFormProps) {
    const supabase = createClient()
    const zh = locale === 'zh-TW'

    const [email, setEmail] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [sent, setSent] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setIsSubmitting(true)

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        })

        setIsSubmitting(false)

        if (resetError) {
            setError(zh ? '傳送失敗，請確認信箱是否正確。' : 'Failed to send. Please check your email address.')
            return
        }

        setSent(true)
    }

    if (sent) {
        return (
            <div className="w-full max-w-sm space-y-4 rounded-lg border p-6 text-center">
                <div className="text-4xl">📩</div>
                <h1 className="text-xl font-bold">
                    {zh ? '已傳送重設連結' : 'Check your email'}
                </h1>
                <p className="text-sm text-ink/60">
                    {zh
                        ? `我們已傳送密碼重設連結到 ${email}，請查看你的信箱。`
                        : `We sent a password reset link to ${email}.`}
                </p>
                <a href="/login" className="block text-sm text-plate underline">
                    {zh ? '回到登入頁' : 'Back to login'}
                </a>
            </div>
        )
    }

    return (
        <form
            onSubmit={handleSubmit}
            className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        >
            <h1 className="text-2xl font-bold">
                {zh ? '重設密碼' : 'Reset Password'}
            </h1>
            <p className="text-sm text-ink/60">
                {zh
                    ? '輸入你的信箱，我們會傳送重設密碼的連結。'
                    : 'Enter your email and we\'ll send you a reset link.'}
            </p>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <div className="space-y-1">
                <label htmlFor="email" className="text-sm font-medium">
                    {zh ? '電子郵件' : 'Email'}
                </label>
                <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-black py-2 text-white disabled:opacity-50"
            >
                {isSubmitting
                    ? (zh ? '傳送中...' : 'Sending...')
                    : (zh ? '傳送重設連結' : 'Send Reset Link')}
            </button>

            <a href="/login" className="block text-center text-sm text-ink/40 underline">
                {zh ? '回到登入頁' : 'Back to login'}
            </a>
        </form>
    )
}