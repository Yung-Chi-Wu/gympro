'use client'

interface InAppLangToggleProps {
    currentLocale: string
}

export function InAppLangToggle({ currentLocale }: InAppLangToggleProps) {
    function toggle() {
        const next = currentLocale === 'zh-TW' ? 'en' : 'zh-TW'
        document.cookie = `language=${next}; path=/; max-age=${60 * 60 * 24 * 365}`
        // 完整重載確保所有 server component 重新讀取 cookie
        window.location.reload()
    }

    return (
        <button
            type="button"
            onClick={toggle}
            className="text-xs font-medium text-[#2B2B28]/50 dark:text-white/50 hover:text-[#2B2B28] dark:hover:text-white transition-colors"
        >
            {currentLocale === 'zh-TW' ? 'EN' : '繁中'}
        </button>
    )
}