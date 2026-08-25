'use client'

interface ThemeSelectorProps {
    isZhTW: boolean
    value: string
    onChange: (theme: string) => void
}

export function ThemeSelector({ isZhTW, value, onChange }: ThemeSelectorProps) {
    const options = [
        { value: 'system', labelZh: '系統', labelEn: 'System' },
        { value: 'light', labelZh: '日間', labelEn: 'Light' },
        { value: 'dark', labelZh: '夜間', labelEn: 'Dark' },
    ]

    return (
        <div className="flex gap-2">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={`flex-1 rounded-xl border-2 py-2 text-sm font-medium transition-colors ${value === opt.value
                            ? 'border-plate bg-plate text-chalk dark:border-white dark:bg-white dark:text-[#1A1814]'
                            : 'border-ink/20 dark:border-white/30 text-ink/60 dark:text-white/60 hover:border-ink/40 dark:hover:border-white/50'
                        }`}
                >
                    {isZhTW ? opt.labelZh : opt.labelEn}
                </button>
            ))}
        </div>
    )
}