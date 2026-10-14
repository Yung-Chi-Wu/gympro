import { getLocale, getTranslations } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'
import { LogoLink } from '@/components/LogoLink'
import { LoginForm } from '@/components/LoginForm'

// A sign-in that didn't finish comes back here with ?error=: app/auth/callback (Google,
// Facebook and password reset links) sends oauth_failed, app/(auth)/callback auth_failed.
// Any other value gets the general message, and the value itself is never shown.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const [locale, t, { error }] = await Promise.all([getLocale(), getTranslations('auth.callbackError'), searchParams])
  const errorKey = error === 'oauth_failed' ? 'oauthFailed' : error === 'auth_failed' ? 'authFailed' : 'unknown'

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF8]">
      <div className="flex items-center justify-between p-4">
        <LogoLink />
        <LangToggle currentLocale={locale} />
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <LoginForm locale={locale} initialError={error ? t(errorKey) : null} />
      </div>
    </div>
  )
}
