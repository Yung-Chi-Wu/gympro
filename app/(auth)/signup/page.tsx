import { getLocale } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'
import { LogoLink } from '@/components/LogoLink'
import { SignupForm } from '@/components/SignupForm'
import { InAppBrowserNotice } from '@/components/InstallGuide'

export default async function SignupPage() {
  const locale = await getLocale()

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF8]">
      <div className="flex items-center justify-between p-4">
        <LogoLink />
        <LangToggle currentLocale={locale} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
        {/* In LINE or another app's browser: Google sign-in may be blocked, and it can't install */}
        <div className="w-full max-w-sm empty:hidden">
          <InAppBrowserNotice zh={locale === 'zh-TW'} />
        </div>
        <SignupForm locale={locale} />
      </div>
    </div>
  )
}