'use client'

import { useRouter } from 'next/navigation'

interface LangToggleProps {
    currentLocale: string
}

export function LangToggle({ currentLocale }: LangToggleProps) {
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
            className="text-sm text-ink/40 hover:text-ink"
        >
            {currentLocale === 'zh-TW' ? 'EN' : '繁中'}
        </button>
    )
}