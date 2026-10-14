import { getLocale } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'
import { LogoLink } from '@/components/LogoLink'
import { LoginForm } from '@/components/LoginForm'

export default async function LoginPage() {
  const locale = await getLocale()
  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF8]">
      <div className="flex items-center justify-between p-4">
        <LogoLink />
        <LangToggle currentLocale={locale} />
      </div>
      <div className="flex flex-1 items-center justify-center px-4">
        <LoginForm locale={locale} />
      </div>
    </div>
  )
}