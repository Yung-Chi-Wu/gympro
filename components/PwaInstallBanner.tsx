'use client'

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaInstallBannerProps {
    language: string
}

function isIos(): boolean {
    if (typeof navigator === 'undefined') return false
    // iOS 13+ iPad 的 userAgent 跟 Mac 一樣，要用 maxTouchPoints 區分
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isInStandaloneMode(): boolean {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(display-mode: standalone)').matches ||
        ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
}

export function PwaInstallBanner({ language }: PwaInstallBannerProps) {
    const zh = language === 'zh-TW'
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    const [showAndroid, setShowAndroid] = useState(false)
    const [showIos, setShowIos] = useState(false)

    useEffect(() => {
        // 已安裝或已關閉過就不顯示
        if (isInStandaloneMode()) return
        const dismissed = localStorage.getItem('pwa_prompt_dismissed')
        if (dismissed) return

        if (isIos()) {
            // iOS：顯示手動引導
            setShowIos(true)
        } else {
            // Android/Chrome：等待 beforeinstallprompt
            function handler(e: Event) {
                e.preventDefault()
                setDeferredPrompt(e as BeforeInstallPromptEvent)
                setShowAndroid(true)
            }
            window.addEventListener('beforeinstallprompt', handler)
            return () => window.removeEventListener('beforeinstallprompt', handler)
        }
    }, [])

    function handleDismiss() {
        localStorage.setItem('pwa_prompt_dismissed', 'true')
        setShowAndroid(false)
        setShowIos(false)
    }

    async function handleAndroidInstall() {
        if (!deferredPrompt) return
        await deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') {
            localStorage.setItem('pwa_prompt_dismissed', 'true')
        }
        setShowAndroid(false)
        setDeferredPrompt(null)
    }

    // Android 安裝橫幅
    if (showAndroid) {
        return (
            <div className="fixed bottom-20 left-4 right-4 z-50 sm:bottom-4 sm:left-auto sm:right-4 sm:w-80">
                <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-lg">
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
                            onClick={handleAndroidInstall}
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

    // iOS 引導橫幅
    if (showIos) {
        return (
            <div className="fixed bottom-20 left-4 right-4 z-50" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
                <div className="rounded-xl border border-ink/10 bg-white p-4 shadow-lg">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <p className="text-sm font-semibold">
                                {zh ? '加到主畫面，像 App 一樣使用' : 'Add to Home Screen'}
                            </p>
                            <div className="space-y-1 text-xs text-ink/60">
                                <p>
                                    {zh ? '① 點下方的' : '① Tap the'}
                                    {' '}
                                    <span className="inline-block rounded bg-ink/10 px-1.5 py-0.5 font-mono">
                                        {zh ? '分享 ⬆' : 'Share ⬆'}
                                    </span>
                                    {' '}
                                    {zh ? '按鈕' : 'button'}
                                </p>
                                <p>
                                    {zh
                                        ? '② 選「加入主畫面」'
                                        : '② Select "Add to Home Screen"'}
                                </p>
                                <p>
                                    {zh
                                        ? '③ 點右上角「新增」'
                                        : '③ Tap "Add" in the top right'}
                                </p>
                            </div>
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
                    {/* 指向底部的小箭頭 */}
                    <div className="mt-2 flex justify-center">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-plate text-chalk text-xs">
                            ↓
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return null
}