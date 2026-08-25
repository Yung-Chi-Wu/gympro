import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { LogoutButton } from '@/components/LogoutButton'
import { BottomNav } from '@/components/BottomNav'
import { SidebarLink } from '@/components/SidebarLink'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const t = await getTranslations('nav')

    const NAV_LINKS = [
        { href: '/dashboard', label: t('dashboard'), icon: '🏠' },
        { href: '/routines', label: t('routines'), icon: '📋' },
        { href: '/history', label: t('history'), icon: '📅' },
        { href: '/settings', label: t('settings'), icon: '⚙' },
    ]

    return (
        <div className="min-h-screen bg-[#FAFAF8] dark:bg-[#1A1814] text-[#1A1814] dark:text-[#EAE7E0]">

            {/* ── Desktop Sidebar ── */}
            <div className="hidden sm:flex h-screen overflow-hidden">
                <aside className="w-56 shrink-0 flex flex-col bg-[#F5F5F3] dark:bg-[#1E1C19] border-r border-gray-200 dark:border-white/10 h-screen sticky top-0 overflow-y-auto">
                    <div className="p-5 border-b border-gray-200 dark:border-white/10">
                        <Link href="/dashboard">
                            <span className="font-bold text-xl tracking-wide text-[#26241F] dark:text-[#EAE7E0]">
                                GYM<span className="font-light text-[#C8955A]">PRO</span>
                            </span>
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

                    <div className="p-4 border-t border-gray-200 dark:border-white/10">
                        <LogoutButton />
                    </div>
                </aside>

                <main className="flex-1 overflow-y-auto bg-[#FAFAF8] dark:bg-[#1A1814]">
                    <div className="max-w-3xl mx-auto px-8 py-8">
                        {children}
                    </div>
                </main>
            </div>

            {/* ── Mobile ── */}
            <div className="sm:hidden flex flex-col min-h-screen bg-[#FAFAF8] dark:bg-[#1A1814]">
                <header className="bg-white dark:bg-[#1E1C19] border-b border-gray-200 dark:border-white/10 px-4 py-3 flex items-center justify-between shrink-0">
                    <Link href="/dashboard">
                        <span className="font-bold text-lg tracking-wide text-[#26241F] dark:text-[#EAE7E0]">
                            GYM<span className="font-light text-[#C8955A]">PRO</span>
                        </span>
                    </Link>
                    <LogoutButton />
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