import { getRequestConfig } from 'next-intl/server'
import { getFrameProfile } from '@/lib/frame-profile'
import { getEffectiveLanguage } from '@/lib/get-language'

// The same language the pages pass down (lib/get-language.ts): a signed-in user's saved
// one, else this device's cookie, else the browser's. Going by the cookie alone, a page on
// a new device would mix the device's language with the saved one.
export default getRequestConfig(async () => {
    const { profile } = await getFrameProfile()
    const locale = await getEffectiveLanguage(profile)

    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    }
})
