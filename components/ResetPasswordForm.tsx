'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface ResetPasswordFormProps {
    locale: string
}

export function ResetPasswordForm({ locale }: ResetPasswordFormProps) {
    const supabase = createClient()
    const router = useRouter()
    const zh = locale === 'zh-TW'

    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)

        if (password !== confirmPassword) {
            setError(zh ? '兩次密碼不一致。' : 'Passwords do not match.')
            return
        }

        if (password.length < 6) {
            setError(zh ? '密碼至少需要 6 個字元。' : 'Password must be at least 6 characters.')
            return
        }

        setIsSubmitting(true)

        const { error: updateError } = await supabase.auth.updateUser({ password })

        setIsSubmitting(false)

        if (updateError) {
            setError(zh ? '重設失敗，請重新嘗試。' : 'Failed to reset password. Please try again.')
            return
        }

        router.push('/dashboard')
        router.refresh()
    }

    return (
        <form
            onSubmit={handleSubmit}
            className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        >
            <h1 className="text-2xl font-bold">
                {zh ? '設定新密碼' : 'Set New Password'}
            </h1>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium">
                    {zh ? '新密碼' : 'New Password'}
                </label>
                <input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            <div className="space-y-1">
                <label htmlFor="confirmPassword" className="text-sm font-medium">
                    {zh ? '確認新密碼' : 'Confirm New Password'}
                </label>
                <input
                    id="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-black py-2 text-white disabled:opacity-50"
            >
                {isSubmitting
                    ? (zh ? '儲存中...' : 'Saving...')
                    : (zh ? '儲存新密碼' : 'Save New Password')}
            </button>
        </form>
    )
}