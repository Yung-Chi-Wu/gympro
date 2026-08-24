import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { LogoutButton } from '@/components/LogoutButton'
import { BottomNav } from '@/components/BottomNav'
import { SidebarLink } from '@/components/SidebarLink'
import { ThemeToggle } from '@/components/ThemeToggle'
import { InAppLangToggle } from '@/components/InAppLangToggle'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const t = await getTranslations('nav')
    const locale = await getLocale()

    const NAV_LINKS = [
        { href: '/dashboard', label: t('dashboard'), icon: '🏠' },
        { href: '/routines', label: t('routines'), icon: '📋' },
        { href: '/history', label: t('history'), icon: '📅' },
        { href: '/settings', label: t('settings'), icon: '⚙' },
    ]

    return (
        <div className="min-h-screen bg-[#FAFAF8] dark:bg-[#1A1814] text-[#2B2B28] dark:text-[#EAE7E0]">

            {/* ── Desktop: Sidebar layout ── */}
            <div className="hidden sm:flex h-screen overflow-hidden">

                {/* Sidebar */}
                <aside className="w-56 shrink-0 flex flex-col bg-[#26241F] text-[#F5F3EC] h-screen sticky top-0 overflow-y-auto">
                    <div className="p-5 border-b border-white/10">
                        <Link href="/dashboard">
                            <img src="/logo-horizontal.svg" alt="GymPro" className="h-7 w-auto" />
                        </Link>
                    </div>

                    <nav className="flex-1 p-3 space-y-1">
                        {NAV_LINKS.map((link) => (
                            <SidebarLink
                                key={link.href}
                                href={link.href}
                                icon={link.icon}
                                label={link.label}
                            />
                        ))}
                    </nav>

                    <div className="p-4 border-t border-white/10 space-y-3">
                        <div className="flex items-center gap-3">
                            <InAppLangToggle currentLocale={locale} />
                            <ThemeToggle />
                        </div>
                        <LogoutButton />
                    </div>
                </aside>

                {/* Main content */}
                <main className="flex-1 overflow-y-auto bg-[#FAFAF8] dark:bg-[#1A1814]">
                    <div className="max-w-3xl mx-auto px-8 py-8">
                        {children}
                    </div>
                </main>
            </div>

            {/* ── Mobile: Top header + bottom nav ── */}
            <div className="sm:hidden flex flex-col min-h-screen bg-[#FAFAF8] dark:bg-[#1A1814]">
                <header className="bg-[#26241F] text-[#F5F3EC] px-4 py-3 flex items-center justify-between shrink-0">
                    <Link href="/dashboard">
                        <img src="/logo-horizontal.svg" alt="GymPro" className="h-7 w-auto" />
                    </Link>
                    <div className="flex items-center gap-3">
                        <InAppLangToggle currentLocale={locale} />
                        <ThemeToggle />
                        <LogoutButton />
                    </div>
                </header>

                <main className="main-content flex-1 bg-[#FAFAF8] dark:bg-[#1A1814]">
                    <div className="px-4 py-6">
                        {children}
                    </div>
                </main>

                <BottomNav links={NAV_LINKS} />
            </div>
        </div>
    )
}