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
    const [error, setError] = useState<string | null>(null)

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setIsSubmitting(true)

        const { error: loginError } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        setIsSubmitting(false)

        if (loginError) {
            setError(zh ? '登入失敗，請確認你的信箱和密碼。' : 'Login failed. Please check your email and password.')
            return
        }

        router.push('/dashboard')
        router.refresh()
    }

    return (
        <form
            onSubmit={handleLogin}
            className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        >
            <h1 className="text-2xl font-bold">
                {zh ? '登入 GymPro' : 'Log in to GymPro'}
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                />
            </div>

            <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-black py-2 text-white disabled:opacity-50"
            >
                {isSubmitting
                    ? (zh ? '登入中...' : 'Logging in...')
                    : (zh ? '登入' : 'Log In')}
            </button>

            <p className="text-center text-sm">
                {zh ? '還沒有帳號？' : "Don't have an account?"}{' '}
                <a href="/signup" className="underline">
                    {zh ? '立即註冊' : 'Sign up'}
                </a>
            </p>
        </form>
    )
}