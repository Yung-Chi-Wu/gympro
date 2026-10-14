'use client'

import { useSyncExternalStore } from 'react'
import { currentBrowserEnv, type BrowserEnv } from '@/lib/browser-env'

// How to put GymPro on the home screen, for the browser it is open in (lib/browser-env.ts):
// the steps for Safari or for another iOS browser, or that it is already installed. The words
// are here in both languages, as in the onboarding modal, which switches language on its first
// step before the page reloads.

const TEXT = {
    zh: {
        installed: '已經加到主畫面了，之後從主畫面的 GymPro 圖示開啟就好。',
        safari: ['點 Safari 下方的分享按鈕（方框加箭頭）；沒看到的話，先點「⋯」再點「分享」', '往下滑，選「加入主畫面」', '點右上角的「新增」'],
        otherIos: ['點網址列旁的分享按鈕，或「⋯」選單裡的「分享」', '選「加入主畫面」', '點右上角的「新增」'],
        otherIosNote: '需要 iOS 16.4 以上；找不到「加入主畫面」的話，改用 Safari 開啟。',
        other: '在手機瀏覽器的選單裡選「加到主畫面」或「安裝應用程式」。iPhone 請用 Safari 開啟。',
    },
    en: {
        installed: 'GymPro is already on your home screen. Open it from the GymPro icon there.',
        safari: ["Tap Safari's Share button (a box with an arrow); if you don't see it, tap ⋯ and then Share", 'Scroll down and choose Add to Home Screen', 'Tap Add in the top-right corner'],
        otherIos: ['Tap the Share button by the address bar, or Share in the ⋯ menu', 'Choose Add to Home Screen', 'Tap Add in the top-right corner'],
        otherIosNote: 'This needs iOS 16.4 or later. If Add to Home Screen is missing, open the page in Safari.',
        other: "Choose Add to Home Screen or Install app from your phone browser's menu. On an iPhone, use Safari.",
    },
}

const subscribeNothing = () => () => {}

/** The browser this page is open in; null while rendering on the server, so nothing mismatches */
function useBrowserEnv(): BrowserEnv | null {
    return useSyncExternalStore(subscribeNothing, currentBrowserEnv, () => null)
}

export function InstallGuide({ zh }: { zh: boolean }) {
    const env = useBrowserEnv()
    const text = zh ? TEXT.zh : TEXT.en
    if (!env) return null
    if (env === 'installed') return <p className="text-[13px] text-good">✓ {text.installed}</p>
    if (env === 'other') return <p className="text-[13px] text-muted">{text.other}</p>
    const steps = env === 'ios_safari' ? text.safari : text.otherIos
    return (
        <div className="space-y-2">
            <ol className="space-y-1.5">
                {steps.map((s, i) => (
                    <li key={i} className="grid grid-cols-[22px_1fr] items-start gap-2 text-[13px] text-muted">
                        <span className="flex size-[22px] items-center justify-center rounded-full bg-ink/10 text-xs font-bold text-ink">{i + 1}</span>
                        <span className="pt-0.5">{s}</span>
                    </li>
                ))}
            </ol>
            {env === 'ios_other' && <p className="text-xs text-faint">{text.otherIosNote}</p>}
        </div>
    )
}
