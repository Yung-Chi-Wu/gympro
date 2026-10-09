'use client'

interface LangToggleProps {
    currentLocale: string
    className?: string
}

export function LangToggle({ currentLocale, className = 'text-sm text-ink/40 hover:text-ink' }: LangToggleProps) {
    const next = currentLocale === 'zh-TW' ? 'en' : 'zh-TW'

    function toggle() {
        document.cookie = `language=${next}; path=/; max-age=${60 * 60 * 24 * 365}`
        window.location.reload()
    }

    return (
        <button
            type="button"
            onClick={toggle}
            lang={next === 'zh-TW' ? 'zh-Hant' : 'en'}
            className={className}
        >
            {next === 'zh-TW' ? '繁中' : 'EN'}
        </button>
    )
}
