import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTranslations, getLocale } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'
import { LogoLink } from '@/components/LogoLink'
import { RonnieChatMock, CycleMock, LogMock, AskMock, ReportMock } from '@/components/WelcomeMockups'

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations('welcome.meta'), getLocale()])

  return {
    title: t('title'),
    description: t('description'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      siteName: 'GymPro',
      type: 'website',
      locale: locale === 'zh-TW' ? 'zh_TW' : 'en_US',
    },
    twitter: {
      card: 'summary',
      title: t('title'),
      description: t('description'),
    },
  }
}

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8955A]'
const primaryButton = `inline-flex min-h-12 items-center justify-center rounded-xl bg-[#26241F] px-6 py-3 font-semibold text-white shadow-lg transition-opacity hover:opacity-90 dark:bg-[#F5F3EC] dark:text-[#1A1814] ${focusRing}`
const eyebrow = 'flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink/60'

const STEPS = [
  { key: 'plan', Visual: CycleMock },
  { key: 'log', Visual: LogMock },
  { key: 'ask', Visual: AskMock },
  { key: 'review', Visual: ReportMock },
]

const DETAILS = ['languages', 'units', 'themes', 'install']

// The welcome page for signed-out visitors: what GymPro does, then sign up or log in.
// Signed-in users go straight to the dashboard.
export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  const t = await getTranslations('welcome')
  const locale = await getLocale()

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-ink dark:bg-[#1A1814]">
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-[#FAFAF8]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <LogoLink />
          <div className="flex items-center gap-1 sm:gap-2">
            <LangToggle currentLocale={locale}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink/60 hover:text-ink ${focusRing}`} />
            <Link href="/login"
              className={`inline-flex min-h-11 items-center rounded-xl border-2 border-ink/80 px-4 text-sm font-semibold transition-opacity hover:opacity-80 dark:border-white/60 ${focusRing}`}>
              {t('login')}
            </Link>
            <Link href="/signup"
              className={`hidden min-h-11 items-center rounded-xl bg-[#26241F] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:inline-flex dark:bg-[#F5F3EC] dark:text-[#1A1814] ${focusRing}`}>
              {t('signup')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-24">
          <div className="space-y-6">
            <p className={eyebrow}>
              <span className="h-0.5 w-6 rounded-full bg-[#C8955A]" aria-hidden="true" />
              {t('hero.eyebrow')}
            </p>
            <h1 className="text-[2rem] font-bold leading-tight tracking-tight sm:text-5xl sm:leading-tight">
              {t.rich('hero.title', {
                em: (chunks) => (
                  <span className="underline decoration-[#C8955A] decoration-[3px] underline-offset-[0.2em]">{chunks}</span>
                ),
              })}
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-ink/70 sm:text-lg">{t('hero.body')}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
              <Link href="/signup" className={primaryButton}>{t('signup')}</Link>
              <p className="text-center text-sm text-ink/70 sm:text-left">
                {t('hasAccount')}{' '}
                <Link href="/login" className={`inline-flex min-h-11 items-center rounded font-semibold text-ink underline underline-offset-4 ${focusRing}`}>
                  {t('login')}
                </Link>
              </p>
            </div>
          </div>
          <RonnieChatMock />
        </section>

        {/* How it works */}
        <section aria-labelledby="how-title" className="border-t border-ink/10">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="max-w-2xl space-y-3">
              <p className={eyebrow}>
                <span className="h-0.5 w-6 rounded-full bg-[#C8955A]" aria-hidden="true" />
                {t('how.eyebrow')}
              </p>
              <h2 id="how-title" className="text-2xl font-bold tracking-tight sm:text-3xl">{t('how.title')}</h2>
              <p className="leading-relaxed text-ink/70">{t('how.intro')}</p>
            </div>

            <ol className="mt-10 grid gap-4 sm:grid-cols-2">
              {STEPS.map(({ key, Visual }, i) => (
                <li key={key} className="flex flex-col gap-5 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-ink/60">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C8955A] text-[11px] font-bold text-[#1A1814]" aria-hidden="true">
                        {i + 1}
                      </span>
                      {t(`how.${key}.step`)}
                    </p>
                    <h3 className="text-lg font-semibold">{t(`how.${key}.title`)}</h3>
                    <p className="text-sm leading-relaxed text-ink/70">{t(`how.${key}.body`)}</p>
                  </div>
                  <div className="mt-auto">
                    <Visual />
                  </div>
                </li>
              ))}
            </ol>

            <ul aria-label={t('details.label')} className="mt-8 flex flex-wrap gap-2">
              {DETAILS.map((key) => (
                <li key={key} className="rounded-full border border-ink/15 px-3 py-1.5 text-sm text-ink/70">
                  {t(`details.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final call to action */}
        <section aria-labelledby="cta-title" className="px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="mx-auto max-w-6xl rounded-3xl bg-[#26241F] px-6 py-12 text-center text-[#F5F3EC] sm:py-16 dark:ring-1 dark:ring-white/10">
            <h2 id="cta-title" className="text-2xl font-bold tracking-tight sm:text-3xl">{t('cta.title')}</h2>
            <p className="mx-auto mt-3 max-w-md leading-relaxed text-[#F5F3EC]/75">{t('cta.body')}</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup"
                className={`inline-flex min-h-12 w-full max-w-xs items-center justify-center rounded-xl bg-[#F5F3EC] px-6 font-semibold text-[#1A1814] transition-opacity hover:opacity-90 sm:w-auto ${focusRing}`}>
                {t('signup')}
              </Link>
              <Link href="/login"
                className={`inline-flex min-h-12 w-full max-w-xs items-center justify-center rounded-xl border-2 border-[#F5F3EC]/50 px-6 font-semibold text-[#F5F3EC] transition-opacity hover:opacity-80 sm:w-auto ${focusRing}`}>
                {t('login')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink/10">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm font-bold uppercase tracking-wide sm:px-6">
          GYM<span className="text-[#C8955A]">PRO</span>
        </p>
      </footer>
    </div>
  )
}
