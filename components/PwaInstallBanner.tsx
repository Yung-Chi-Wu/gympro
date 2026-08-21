'use client'

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaInstallBannerProps {
    language: string
}

export function PwaInstallBanner({ language }: PwaInstallBannerProps) {
    const zh = language === 'zh-TW'
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    const [show, setShow] = useState(false)

    useEffect(() => {
        // 已經安裝或使用者已關閉過就不顯示
        const dismissed = localStorage.getItem('pwa_prompt_dismissed')
        if (dismissed) return

        // 已經是 standalone 模式（已安裝）就不顯示
        if (window.matchMedia('(display-mode: standalone)').matches) return

        function handler(e: Event) {
            e.preventDefault()
            setDeferredPrompt(e as BeforeInstallPromptEvent)
            setShow(true)
        }

        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [])

    async function handleInstall() {
        if (!deferredPrompt) return
        await deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
            localStorage.setItem('pwa_prompt_dismissed', 'true')
        }
        setShow(false)
        setDeferredPrompt(null)
    }

    function handleDismiss() {
        localStorage.setItem('pwa_prompt_dismissed', 'true')
        setShow(false)
    }

    if (!show) return null

    return (
        <div className="fixed bottom-20 left-4 right-4 z-50 sm:bottom-4 sm:left-auto sm:right-4 sm:w-80">
            <div className="rounded-2xl border border-ink/10 bg-white p-4 shadow-lg">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                        <p className="text-sm font-semibold">
                            {zh ? '加到主畫面' : 'Add to Home Screen'}
                        </p>
                        <p className="text-xs text-ink/60">
                            {zh
                                ? '像 App 一樣使用 GymPro，一鍵開啟。'
                                : 'Use GymPro like an app — one tap to open.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="shrink-0 text-ink/30 hover:text-ink"
                        aria-label="Dismiss"
                    >
                        ✕
                    </button>
                </div>
                <div className="mt-3 flex gap-2">
                    <button
                        type="button"
                        onClick={handleInstall}
                        className="flex-1 rounded-md bg-plate px-3 py-2 text-sm font-medium text-chalk"
                    >
                        {zh ? '安裝' : 'Install'}
                    </button>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="rounded-md border px-3 py-2 text-sm text-ink/60"
                    >
                        {zh ? '不用了' : 'Not now'}
                    </button>
                </div>
            </div>
        </div>
    )
}