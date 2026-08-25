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
        <div className="space-y-2">
          <h1 className="text-4xl font-bold uppercase tracking-wide">
            GYM<span className="text-[#C8955A]">PRO</span>
          </h1>
          <p className="max-w-sm text-sm text-ink/60">{t('tagline')}</p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-3">
          {/* 登入——主要 CTA，深色底白字，在任何模式都明顯 */}

          <a href="/login"
            className="rounded-xl bg-[#26241F] px-4 py-3.5 text-center font-semibold text-white hover:bg-[#3E3B34] transition-colors shadow-lg"
          >
            {t('login')}
          </a>

          {/* 建立帳號——次要，有明顯邊框 */}

          <a href="/signup"
            className="rounded-xl border-2 border-[#26241F] px-4 py-3.5 text-center font-semibold text-[#26241F] hover:bg-[#26241F] hover:text-white transition-colors"
          >
            {t('signup')}
          </a>
        </div>
      </div>
    </div>
  )
}