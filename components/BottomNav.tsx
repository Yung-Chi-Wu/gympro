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

// The phone's tab bar (below md): a rounded bar floating over the bottom of the page, the page
// showing through it blurred. Where it sits is --tab-bar-bottom and --tab-bar-top (globals.css),
// which Ronnie and the toasts also go by. It hides while the on-screen keyboard is open. A tapped
// tab is marked at once, while its page loads (lib/nav-target.ts).
export function BottomNav({ links }: { links: NavLink[] }) {
    const pathname = useShownPath()
    const keyboardOpen = useKeyboardOpen()

    if (keyboardOpen) return null

    return (
        // Taps beside the bar reach the page under it
        <div className="pointer-events-none fixed inset-x-0 bottom-(--tab-bar-bottom) z-40 px-4 md:hidden">
            {/* .bottom-nav: Ronnie's button keeps above it when dragged. The card at 90% keeps the
                words readable over any page; the active tab has a soft fill as well as its colors */}
            <nav className="bottom-nav pointer-events-auto mx-auto grid h-14 max-w-[420px] grid-cols-4 rounded-full border border-line bg-card/90 p-1 shadow-[0_6px_18px_rgb(0_0_0/0.12)] backdrop-blur-lg backdrop-saturate-150">
                {links.map((link) => {
                    const active = isActiveLink(link.href, pathname)
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            onNavigate={() => markNavigation(link.href)}
                            aria-current={active ? 'page' : undefined}
                            className={`flex flex-col items-center justify-center gap-0.5 rounded-full text-xs transition-transform active:scale-90 ${active ? 'bg-accent-soft font-bold text-ink' : 'font-medium text-muted'}`}
                        >
                            <Icon name={link.icon} className={`size-[22px] ${active ? 'text-accent' : ''}`} />
                            {link.label}
                        </Link>
                    )
                })}
            </nav>
        </div>
    )
}
