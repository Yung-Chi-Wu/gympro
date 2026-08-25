'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface LoginFormProps {
    locale: string
}

export function LoginForm({ locale }: LoginFormProps) {
    const router = useRouter()
    const supabase = createClient()
    const zh = locale === 'zh-TW'

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [oauthLoading, setOauthLoading] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [needsVerification, setNeedsVerification] = useState(false)
    const [resendSent, setResendSent] = useState(false)

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setNeedsVerification(false)
        setIsSubmitting(true)

        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })

        setIsSubmitting(false)

        if (loginError) {
            if (loginError.message.toLowerCase().includes('email not confirmed')) {
                setNeedsVerification(true)
            } else {
                setError(zh ? '登入失敗，請確認你的信箱和密碼。' : 'Login failed. Please check your email and password.')
            }
            return
        }

        router.push('/dashboard')
        router.refresh()
    }

    async function handleResendVerification() {
        const { error } = await supabase.auth.resend({ type: 'signup', email })
        if (!error) setResendSent(true)
    }

    async function handleOAuth(provider: 'google' | 'facebook') {
        setError(null)
        setOauthLoading(provider)

        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        })

        if (error) {
            setError(zh ? '登入失敗，請再試一次。' : 'Login failed. Please try again.')
            setOauthLoading(null)
        }
    }

    return (
        <form
            onSubmit={handleLogin}
            className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        >
            <h1 className="text-2xl font-bold">
                {zh ? '登入 GymPro' : 'Log in to GymPro'}
            </h1>

            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

            {needsVerification && (
                <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 space-y-2">
                    <p className="text-sm text-yellow-800">
                        {zh ? '你的信箱還未驗證，請查看你的信箱。' : 'Your email is not verified. Please check your inbox.'}
                    </p>
                    {resendSent ? (
                        <p className="text-xs text-yellow-700">
                            {zh ? '已重新傳送驗證信！' : 'Verification email resent!'}
                        </p>
                    ) : (
                        <button
                            type="button"
                            onClick={handleResendVerification}
                            className="text-xs text-yellow-800 underline"
                        >
                            {zh ? '重新傳送驗證信' : 'Resend verification email'}
                        </button>
                    )}
                </div>
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
                <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium">
                        {zh ? '密碼' : 'Password'}
                    </label>
                    <a href="/forgot-password" className="text-xs text-ink/40 hover:text-ink underline">
                        {zh ? '忘記密碼？' : 'Forgot password?'}
                    </a>
                </div>
                <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            <button
                type="submit"
                disabled={isSubmitting || !!oauthLoading}
                className="w-full rounded-md bg-black py-2 text-white disabled:opacity-50"
            >
                {isSubmitting
                    ? (zh ? '登入中...' : 'Logging in...')
                    : (zh ? '登入' : 'Log In')}
            </button>

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-ink/10" />
                </div>
                <div className="relative flex justify-center text-xs text-ink/40">
                    <span className="bg-white px-2">{zh ? '或' : 'or'}</span>
                </div>
            </div>

            <div className="flex justify-center gap-4">
                <button
                    type="button"
                    onClick={() => handleOAuth('google')}
                    disabled={!!oauthLoading}
                    aria-label="Continue with Google"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 bg-white transition hover:bg-ink/5 disabled:opacity-50"
                >
                    {oauthLoading === 'google' ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
                    ) : (
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => handleOAuth('facebook')}
                    disabled={!!oauthLoading}
                    aria-label="Continue with Facebook"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/20 bg-white transition hover:bg-ink/5 disabled:opacity-50"
                >
                    {oauthLoading === 'facebook' ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink/20 border-t-[#1877F2]" />
                    ) : (
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                        </svg>
                    )}
                </button>
            </div>

            <p className="text-center text-sm">
                {zh ? '還沒有帳號？' : "Don't have an account?"}{' '}
                <a href="/signup" className="underline">{zh ? '立即註冊' : 'Sign up'}</a>
            </p>
        </form>
    )
}