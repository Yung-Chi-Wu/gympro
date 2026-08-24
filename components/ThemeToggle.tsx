'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    useEffect(() => setMounted(true), [])
    if (!mounted) return <div className="w-7 h-7" />

    const isDark = resolvedTheme === 'dark'

    return (
        <button
            type="button"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-[#2B2B28]/50 dark:text-white/50 hover:text-[#2B2B28] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="Toggle dark mode"
        >
            <span className="text-base">{isDark ? '☀️' : '🌙'}</span>
        </button>
    )
}