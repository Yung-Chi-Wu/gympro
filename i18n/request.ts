import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

export default getRequestConfig(async () => {
    const cookieStore = await cookies()
    const language = cookieStore.get('language')?.value ?? 'en'
    const locale = language === 'zh-TW' ? 'zh-TW' : 'en'

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    }
})