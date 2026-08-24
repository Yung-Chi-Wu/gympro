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
                    ? 'bg-[#26241F] text-white dark:bg-white/15 dark:text-white font-medium'
                    : 'text-[#2B2B28]/60 dark:text-white/50 hover:bg-[#26241F]/8 dark:hover:bg-white/10 hover:text-[#2B2B28] dark:hover:text-white'
                }`}
        >
            <span className="text-base leading-none">{icon}</span>
            {label}
        </Link>
    )
}