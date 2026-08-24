'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SidebarLinkProps {
    href: string
    icon: string
    label: string
}

export function SidebarLink({ href, icon, label }: SidebarLinkProps) {
    const pathname = usePathname()
    const isActive = href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname.startsWith(href)

    return (
        <Link
            href={href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${isActive
                    ? 'bg-white/15 text-chalk font-medium'
                    : 'text-chalk/50 hover:text-chalk hover:bg-white/10'
                }`}
        >
            <span className="text-base leading-none">{icon}</span>
            {label}
        </Link>
    )
}