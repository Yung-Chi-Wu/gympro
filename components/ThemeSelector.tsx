'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

interface ThemeSelectorProps {
    isZhTW: boolean
}

export function ThemeSelector({ isZhTW }: ThemeSelectorProps) {
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    useEffect(() => setMounted(true), [])
    if (!mounted) return null

    const options = [
        { value: 'system', labelZh: '跟系統走', labelEn: 'System' },
        { value: 'light', labelZh: '日間', labelEn: 'Light' },
        { value: 'dark', labelZh: '夜間', labelEn: 'Dark' },
    ]

    return (
        <div className="flex gap-2">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className={`flex-1 rounded-xl border-2 py-2 text-sm font-medium transition-colors ${theme === opt.value
                            ? 'border-plate bg-plate text-chalk'
                            : 'border-ink/20 text-ink/60 hover:border-ink/40'
                        }`}
                >
                    {isZhTW ? opt.labelZh : opt.labelEn}
                </button>
            ))}
        </div>
    )
}