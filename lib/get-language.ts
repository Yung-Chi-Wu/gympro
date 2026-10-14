import { cookies, headers } from 'next/headers'
import type { Database } from '@/lib/types/database.types'

type SavedLanguage = Pick<Database['public']['Tables']['user_profiles']['Row'], 'language' | 'onboarding_completed'>

export async function getEffectiveLanguage(profile?: SavedLanguage | null): Promise<string> {
    // The user's saved language wins on every device. The column defaults to 'en', so 'en'
    // is only their choice once onboarding (which saves the language picked in its first
    // step) is done; until then they get this device's language, as below.
    if (profile?.language === 'zh-TW') return 'zh-TW'
    if (profile?.onboarding_completed) return 'en'

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