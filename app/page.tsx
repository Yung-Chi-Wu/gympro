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
    <div className="flex min-h-screen flex-col bg-[#FAFAF8]">
      <div className="flex justify-end p-4">
        <LangToggle currentLocale={locale} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-4xl font-bold uppercase tracking-wide">{t('headline')}</h1>
        <p className="max-w-sm text-ink/60">{t('tagline')}</p>
        <div className="flex w-full max-w-xs flex-col gap-3">

          <a href="/login"
            className="rounded-md bg-plate px-4 py-3 text-center font-display uppercase tracking-wide text-chalk hover:bg-plate-light"
          >
            {t('login')}
          </a>

          <a href="/signup"
            className="rounded-md border px-4 py-3 text-center text-sm"
          >
            {t('signup')}
          </a>
        </div>
      </div>
    </div>
  )
}