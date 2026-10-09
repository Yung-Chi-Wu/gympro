'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

// Signs out and goes back to the welcome page. It lives in Settings → 帳號.
export function LogoutButton({ className = 'text-sm text-[#2B2B28]/40 dark:text-white/40 hover:text-red-500 dark:hover:text-red-400 transition-colors' }: { className?: string }) {
    const router = useRouter()
    const supabase = createClient()
    const t = useTranslations('nav')

    async function handleLogout() {
        await supabase.auth.signOut()
        router.push('/')
        router.refresh()
    }

    return (
        <button
            type="button"
            onClick={handleLogout}
            className={className}
        >
            {t('logout')}
        </button>
    )
}