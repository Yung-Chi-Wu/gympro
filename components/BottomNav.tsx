'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLink {
    href: string
    label: string
}

const ICONS: Record<string, string> = {
    '/dashboard': '🏠',
    '/routines': '📋',
    '/history': '📅',
    '/metrics': '📊',
    '/settings': '⚙',
}

export function BottomNav({ links }: { links: NavLink[] }) {
    const pathname = usePathname()

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-ink/10 bg-white sm:hidden">
            {links.map((link) => {
                const isActive =
                    link.href === '/dashboard'
                        ? pathname === '/dashboard'
                        : pathname.startsWith(link.href)
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${isActive ? 'text-ink' : 'text-ink/40'
                            }`}
                    >
                        <span className="text-lg leading-none">{ICONS[link.href]}</span>
                        {link.label}
                    </Link>
                )
            })}
        </nav>
    )
}