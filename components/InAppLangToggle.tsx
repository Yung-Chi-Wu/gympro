'use client'

import { useRouter } from 'next/navigation'

interface InAppLangToggleProps {
    currentLocale: string
}

export function InAppLangToggle({ currentLocale }: InAppLangToggleProps) {
    const router = useRouter()

    function toggle() {
        const next = currentLocale === 'zh-TW' ? 'en' : 'zh-TW'
        document.cookie = `language=${next}; path=/; max-age=${60 * 60 * 24 * 365}`
        router.refresh()
    }

    return (
        <button
            type="button"
            onClick={toggle}
            className="text-xs font-medium text-chalk/50 hover:text-chalk transition-colors"
        >
            {currentLocale === 'zh-TW' ? 'EN' : '繁中'}
        </button>
    )
}