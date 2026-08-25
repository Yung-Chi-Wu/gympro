import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  const t = await getTranslations('welcome')
  const locale = await getLocale()

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF8] dark:bg-[#1A1814]">
      <div className="flex justify-end p-4">
        <LangToggle currentLocale={locale} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold uppercase tracking-wide text-[#26241F] dark:text-[#EAE7E0]">
            GYM<span className="text-[#C8955A]">PRO</span>
          </h1>
          <p className="max-w-sm text-sm text-[#26241F]/60 dark:text-[#EAE7E0]/60">
            {t('tagline')}
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">

          <a href="/login"
            className="rounded-xl bg-[#26241F] dark:bg-[#F5F3EC] px-4 py-3.5 text-center font-semibold text-white dark:text-[#1A1814] hover:opacity-90 transition-opacity shadow-lg"
          >
            {t('login')}
          </a>

          <a href="/signup"
            className="rounded-xl border-2 border-[#26241F] dark:border-white/60 px-4 py-3.5 text-center font-semibold text-[#26241F] dark:text-white hover:opacity-80 transition-opacity"
          >
            {t('signup')}
          </a>
        </div>
      </div>
    </div>
  )
}