'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Icon } from './Icon'
import { isActiveLink, type NavLink } from './BottomNav'
import { SUB_PAGE_PARAM, closeSubPage } from '@/lib/sub-page'

// The phone's slim top bar (below md): the page's name. On a detail page (a routine, a
// day, one setting) it is a back button to the page's list instead. From 672px the page
// is wide enough to show list and detail side by side (@split), so there is nothing to
// go back to and the name stays.
export function AppTopBar({ links }: { links: NavLink[] }) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const page = links.find((link) => isActiveLink(link.href, pathname))
    const param = page ? SUB_PAGE_PARAM[page.href] : undefined
    const back = page && param && searchParams.has(param) ? { label: page.label, param } : null

    return (
        <header
            data-app-bar
            className="sticky top-0 z-30 flex min-h-[calc(52px+env(safe-area-inset-top))] items-center border-b border-line bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden"
        >
            {back && (
                <button
                    type="button"
                    onClick={() => closeSubPage(back.param)}
                    className="-ml-1.5 flex min-h-11 items-center gap-0.5 pr-3 font-medium text-accent min-[672px]:hidden"
                >
                    <Icon name="back" className="size-5" />
                    {back.label}
                </button>
            )}
            <p className={`text-xl font-bold ${back ? 'hidden min-[672px]:block' : ''}`}>
                {page?.label ?? 'GymPro'}
            </p>
        </header>
    )
}
