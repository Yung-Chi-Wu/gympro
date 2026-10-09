'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from './Icon'
import { useKeyboardOpen } from '@/lib/keyboard'

export interface NavLink {
    href: string
    label: string
    icon: IconName
}

export const isActiveLink = (href: string, pathname: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

// The phone's tab bar (below md). It hides while the on-screen keyboard is open.
export function BottomNav({ links }: { links: NavLink[] }) {
    const pathname = usePathname()
    const keyboardOpen = useKeyboardOpen()

    if (keyboardOpen) return null

    return (
        <nav className="bottom-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-card md:hidden">
            {links.map((link) => {
                const active = isActiveLink(link.href, pathname)
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[11px] font-medium transition-transform active:scale-90 ${active ? 'text-ink' : 'text-faint'}`}
                    >
                        <Icon name={link.icon} className={`size-[22px] ${active ? 'text-accent' : ''}`} />
                        {link.label}
                    </Link>
                )
            })}
        </nav>
    )
}
