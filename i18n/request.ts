import { getRequestConfig } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveLanguage } from '@/lib/get-language'

// The same language the pages pass down (lib/get-language.ts): a signed-in user's saved
// one, else this device's cookie, else the browser's. Going by the cookie alone, a page on
// a new device would mix the device's language with the saved one.
export default getRequestConfig(async () => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const profileResult = user ? await supabase
        .from('user_profiles')
        .select('language, onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle() : null

    const locale = await getEffectiveLanguage(profileResult?.data)

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    }
})
