'use server'

import { cookies } from 'next/headers'

export async function setLanguageCookie(language: string) {
    const cookieStore = await cookies()
    cookieStore.set('language', language, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365, // 一年
        httpOnly: false, 
    })
}