'use client'

import Link from 'next/link'
import { Icon, type IconName } from './Icon'
import { useKeyboardOpen } from '@/lib/keyboard'
import { markNavigation, useShownPath } from '@/lib/nav-target'

export interface NavLink {
    href: string
    label: string
    icon: IconName
}

export const isActiveLink = (href: string, pathname: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

// The phone's tab bar (below md). It hides while the on-screen keyboard is open. A tapped tab
// is marked at once, while its page loads (lib/nav-target.ts).
export function BottomNav({ links }: { links: NavLink[] }) {
    const pathname = useShownPath()
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
                        onNavigate={() => markNavigation(link.href)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-xs font-medium transition-transform active:scale-90 ${active ? 'text-ink' : 'text-faint'}`}
                    >
                        <Icon name={link.icon} className={`size-[22px] ${active ? 'text-accent' : ''}`} />
                        {link.label}
                    </Link>
                )
            })}
        </nav>
    )
}
