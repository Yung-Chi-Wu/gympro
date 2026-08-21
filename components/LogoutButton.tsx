'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

export function LogoutButton() {
    const router = useRouter()
    const supabase = createClient()
    const t = useTranslations('nav')

    async function handleLogout() {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    return (
        <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-ink/40 hover:text-red-600"
        >
            {t('logout')}
        </button>
    )
}