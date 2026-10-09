'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'

// A ⋯ button that opens a short menu of secondary actions (rename, delete…), so a row
// keeps one visible action. It closes on a choice, a tap outside, or Escape.

export interface MoreMenuItem {
    label: string
    onSelect: () => void
    danger?: boolean
}

export function MoreMenu({ label, items, className = '' }: { label: string; items: MoreMenuItem[]; className?: string }) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const menuId = useId()

    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    return (
        <div ref={ref} className={`relative shrink-0 ${className}`}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-done hover:text-ink"
            >
                <Icon name="more" className="size-5" />
            </button>
            {open && (
                <div
                    id={menuId}
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 min-w-40 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[0_8px_24px_rgb(0_0_0/0.14)]"
                >
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false)
                                item.onSelect()
                            }}
                            className={`block min-h-11 w-full px-4 text-left text-[15px] hover:bg-done ${item.danger ? 'font-medium text-miss' : ''}`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
