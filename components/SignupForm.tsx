'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface SignupFormProps {
    locale: string
}

export function SignupForm({ locale }: SignupFormProps) {
    const router = useRouter()
    const supabase = createClient()
    const zh = locale === 'zh-TW'

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)

    async function handleSignup(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setIsSubmitting(true)

        const { error: signupError } = await supabase.auth.signUp({
            email,
            password,
        })

        setIsSubmitting(false)

        if (signupError) {
            setError(zh ? '註冊失敗，請確認你的信箱和密碼。' : 'Sign up failed. Please check your email and password.')
            return
        }

        setSuccess(true)
        setTimeout(() => router.push('/dashboard'), 1500)
    }

    if (success) {
        return (
            <div className="w-full max-w-sm space-y-4 rounded-lg border p-6 text-center">
                <p className="text-lg font-medium">
                    {zh ? '註冊成功！' : 'Account created!'}
                </p>
                <p className="text-sm text-ink/60">
                    {zh ? '正在跳轉...' : 'Redirecting...'}
                </p>
            </div>
        )
    }

    return (
        <form
            onSubmit={handleSignup}
            className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        >
            <h1 className="text-2xl font-bold">
                {zh ? '建立 GymPro 帳號' : 'Create your GymPro account'}
            </h1>

            {error && (
                <p role="alert" className="text-sm text-red-600">{error}</p>
            )}

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

            <div className="space-y-1">
                <label htmlFor="password" className="text-sm font-medium">
                    {zh ? '密碼' : 'Password'}
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
                <p className="text-xs text-ink/40">
                    {zh ? '至少 6 個字元' : 'At least 6 characters'}
                </p>
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-black py-2 text-white disabled:opacity-50"
            >
                {isSubmitting
                    ? (zh ? '註冊中...' : 'Signing up...')
                    : (zh ? '建立帳號' : 'Sign Up')}
            </button>

            <p className="text-center text-sm">
                {zh ? '已有帳號？' : 'Already have an account?'}{' '}
                <a href="/login" className="underline">
                    {zh ? '登入' : 'Log in'}
                </a>
            </p>
        </form>
    )
}