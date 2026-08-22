import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'
import { BottomNav } from '@/components/BottomNav'
import { getTranslations } from 'next-intl/server'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const t = await getTranslations('nav')

    const NAV_LINKS = [
        { href: '/routines', label: t('routines') },
        { href: '/history', label: t('history') },
        { href: '/settings', label: t('settings') },
    ]

    const BOTTOM_NAV_LINKS = [
        { href: '/dashboard', label: t('dashboard') },
        { href: '/routines', label: t('routines') },
        { href: '/history', label: t('history') },
        { href: '/settings', label: t('settings') },
    ]

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b border-white/10 bg-plate">
                <nav className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-8">
                    <div className="flex items-center gap-8">
                        <Link href="/dashboard" className="flex items-center shrink-0">
                            <img
                                src="/logo-horizontal.svg"
                                alt="GymPro"
                                className="h-8 w-auto"
                            />
                        </Link>
                        <div className="hidden sm:flex gap-5 text-sm">
                            {NAV_LINKS.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className="text-chalk/60 underline-offset-4 hover:text-chalk hover:underline transition-colors"
                                >
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    </div>
                    <LogoutButton />
                </nav>
            </header>
            <main className="main-content flex-1 sm:pb-0">
                <div className="mx-auto max-w-2xl px-4 sm:px-8">
                    {children}
                </div>
            </main>
            <BottomNav links={BOTTOM_NAV_LINKS} />
        </div>
    )
}