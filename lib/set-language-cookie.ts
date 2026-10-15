'use server'

import { cookies } from 'next/headers'

// A server action takes any value from the browser: only a language the app has is written
const LANGUAGES = ['zh-TW', 'en']

export async function setLanguageCookie(language: string) {
    if (!LANGUAGES.includes(language)) return
    const cookieStore = await cookies()
    cookieStore.set('language', language, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 一年
        httpOnly: false,
    })
}