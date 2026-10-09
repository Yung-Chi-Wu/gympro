'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from './Icon'
import { isActiveLink, type NavLink } from './BottomNav'
import { useRonnie } from './RonnieWidget'

// The sidebar's items (md and up). On a tablet (md to lg) the sidebar is icons only: the
// label stays for screen readers and shows as a tooltip.

const ITEM = 'flex items-center gap-2.5 rounded-[9px] px-2.5 py-2.5 text-sm font-medium transition-colors max-lg:justify-center'

export function SidebarLink({ href, label, icon }: NavLink) {
    const pathname = usePathname()
    const active = isActiveLink(href, pathname)

    return (
        <Link
            href={href}
            title={label}
            aria-current={active ? 'page' : undefined}
            className={`${ITEM} ${active
                ? 'bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
                : 'text-muted hover:bg-card/60 hover:text-ink'}`}
        >
            <Icon name={icon} className={`size-5 ${active ? 'text-accent' : ''}`} />
            <span className="max-lg:sr-only">{label}</span>
        </Link>
    )
}

/** 問 Ronnie at the bottom of the sidebar: opens Ronnie as a column on the right, or closes it */
export function AskRonnieButton({ label }: { label: string }) {
    const { isOpen, toggle } = useRonnie()

    return (
        <button
            type="button"
            onClick={toggle}
            title={label}
            aria-expanded={isOpen}
            className={`${ITEM} w-full font-bold ${isOpen
                ? 'bg-accent text-accent-ink'
                : 'bg-ink text-card hover:opacity-90'}`}
        >
            <Icon name="chat" className="size-5" />
            <span className="max-lg:sr-only">{label}</span>
        </button>
    )
}
