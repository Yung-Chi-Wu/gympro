import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'

export default getRequestConfig(async () => {
    const cookieStore = await cookies()
    const cookieLang = cookieStore.get('language')?.value

    let locale = 'en'

    if (cookieLang) {
        locale = cookieLang === 'zh-TW' ? 'zh-TW' : 'en'
    } else {
        // 沒有 cookie，讀瀏覽器語言設定
        const headerStore = await headers()
        const acceptLanguage = headerStore.get('accept-language') ?? ''
        if (acceptLanguage.toLowerCase().includes('zh-tw') ||
            acceptLanguage.toLowerCase().includes('zh_tw') ||
            acceptLanguage.toLowerCase().includes('zh-hant')) {
            locale = 'zh-TW'
        } else if (acceptLanguage.toLowerCase().startsWith('zh')) {
            // zh-CN 也給繁中（台灣用戶有時候設 zh）
            locale = 'zh-TW'
        }
    }

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    }
})