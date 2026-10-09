import Link from 'next/link'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { AppTopBar } from '@/components/AppTopBar'
import { BottomNav, type NavLink } from '@/components/BottomNav'
import { AskRonnieButton, SidebarLink } from '@/components/SidebarLink'
import { RonnieProvider, RonnieWidget } from '@/components/RonnieWidget'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveLanguage } from '@/lib/get-language'

// The signed-in app's frame. Each page renders once inside <main>; what's around it
// depends on the width:
//   phone (below md): a slim top bar with the page's name, the tab bar at the bottom, and
//     Ronnie's draggable button
//   tablet (md to lg): a sidebar of icons on the left
//   desktop (lg up): the sidebar with the logo and labels
// From md up, 問 Ronnie at the bottom of the sidebar opens Ronnie as a column on the right.
// <main> is a size container: pages split into list and detail by its width (@split), so
// they also fit when Ronnie's column makes it narrower.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const t = await getTranslations('nav')
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const profileResult = user ? await supabase
        .from('user_profiles')
        .select('language')
        .eq('user_id', user.id)
        .maybeSingle() : null

    const language = await getEffectiveLanguage(profileResult?.data?.language)

    const NAV_LINKS: NavLink[] = [
        { href: '/dashboard', label: t('dashboard'), icon: 'today' },
        { href: '/routines', label: t('routines'), icon: 'routines' },
        { href: '/history', label: t('history'), icon: 'history' },
        { href: '/settings', label: t('settings'), icon: 'settings' },
    ]

    return (
        <RonnieProvider>
            <div className="min-h-dvh bg-background text-ink md:flex md:h-dvh md:overflow-hidden">

                {/* ── Sidebar (md and up) ── */}
                <aside className="hidden w-16 shrink-0 flex-col gap-5 border-r border-line bg-side px-2 py-4 md:flex lg:w-56 lg:px-3">
                    <Link href="/dashboard" className="flex items-center justify-center lg:justify-start lg:px-1.5">
                        <Image src="/gympro-icon.svg" alt="GymPro" width={36} height={36} className="size-9 rounded-[10px] lg:hidden" />
                        <span className="hidden lg:block">
                            <Image src="/logo-horizontal-light.svg" alt="GymPro" width={260} height={80}
                                className="block h-10 w-auto dark:hidden" />
                            <Image src="/logo-horizontal-dark.svg" alt="GymPro" width={260} height={80}
                                className="hidden h-10 w-auto dark:block" />
                        </span>
                    </Link>

                    <nav className="flex flex-1 flex-col gap-0.5">
                        {NAV_LINKS.map((link) => (
                            <SidebarLink key={link.href} {...link} />
                        ))}
                    </nav>

                    {user && <AskRonnieButton label={t('askRonnie')} />}
                </aside>

                {/* ── Page ── */}
                <div className="flex min-w-0 flex-1 flex-col md:h-dvh">
                    <AppTopBar links={NAV_LINKS} />
                    <main className="main-content @container flex-1 md:overflow-y-auto">
                        <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-6 md:py-6 lg:px-8">
                            {children}
                        </div>
                    </main>
                </div>

                {user && <RonnieWidget language={language} userId={user.id} />}

                <BottomNav links={NAV_LINKS} />
            </div>
        </RonnieProvider>
    )
}
