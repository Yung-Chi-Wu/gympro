import { cookies, headers } from 'next/headers'

export async function getEffectiveLanguage(dbLanguage?: string | null): Promise<string> {
    // 如果 DB 已經有非預設的語言設定，直接用
    if (dbLanguage && dbLanguage !== 'en') return dbLanguage

    // 優先讀 cookie（使用者曾經在 Settings 選過語言）
    const cookieStore = await cookies()
    const cookieLang = cookieStore.get('language')?.value
    if (cookieLang) return cookieLang === 'zh-TW' ? 'zh-TW' : 'en'

    // 最後 fallback：讀瀏覽器語言
    const headerStore = await headers()
    const acceptLanguage = headerStore.get('accept-language') ?? ''
    if (
        acceptLanguage.toLowerCase().includes('zh-tw') ||
        acceptLanguage.toLowerCase().includes('zh_tw') ||
        acceptLanguage.toLowerCase().includes('zh-hant') ||
        acceptLanguage.toLowerCase().startsWith('zh')
    ) {
        return 'zh-TW'
    }

    return 'en'
}