'use client'

export function getCurrentLanguage(): string {
    if (typeof document === 'undefined') return 'en'
    const match = document.cookie.match(/(?:^|;\s*)language=([^;]*)/)
    return match ? match[1] : 'en'
}