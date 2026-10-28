'use client'

import { SEGMENTED } from '@/lib/ui'

interface ThemeSelectorProps {
    isZhTW: boolean
    value: string
    onChange: (theme: string) => void
}

export function ThemeSelector({ isZhTW, value, onChange }: ThemeSelectorProps) {
    const options = [
        { value: 'system', labelZh: '跟隨系統', labelEn: 'System' },
        { value: 'light', labelZh: '日間', labelEn: 'Light' },
        { value: 'dark', labelZh: '夜間', labelEn: 'Dark' },
    ]

    return (
        <div role="radiogroup" className={SEGMENTED.track}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={value === opt.value}
                    onClick={() => onChange(opt.value)}
                    className={`${SEGMENTED.segment} flex-1`}
                >
                    {isZhTW ? opt.labelZh : opt.labelEn}
                </button>
            ))}
        </div>
    )
}
