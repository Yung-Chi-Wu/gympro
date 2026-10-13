'use client'

import { useState, useSyncExternalStore } from 'react'
import { currentBrowserEnv, externalBrowserUrl, type BrowserEnv } from '@/lib/browser-env'

// How to put GymPro on the home screen, for the browser it is open in (lib/browser-env.ts):
// the steps for Safari or for another iOS browser, a way out of LINE or another app's browser,
// or that it is already installed. The words are here in both languages, as in the onboarding
// modal, which switches language on its first step before the page reloads.

const TEXT = {
    zh: {
        installed: '已經加到主畫面了，之後從主畫面的 GymPro 圖示開啟就好。',
        safari: ['點 Safari 下方的分享按鈕（方框加箭頭）；沒看到的話，先點「⋯」再點「分享」', '往下滑，選「加入主畫面」', '點右上角的「新增」'],
        otherIos: ['點網址列旁的分享按鈕，或「⋯」選單裡的「分享」', '選「加入主畫面」', '點右上角的「新增」'],
        otherIosNote: '需要 iOS 16.4 以上；找不到「加入主畫面」的話，改用 Safari 開啟。',
        line: 'LINE 的內建瀏覽器不能把網頁加到主畫面。用 Safari 開啟後登入，再照步驟加入。',
        inApp: '這個 App 的內建瀏覽器不能把網頁加到主畫面。點右上角的「⋯」，選「在 Safari 中開啟」（或「用瀏覽器開啟」），登入後再照步驟加入。',
        other: '在手機瀏覽器的選單裡選「加到主畫面」或「安裝應用程式」。iPhone 請用 Safari 開啟。',
        openSafari: '用 Safari 開啟',
        copy: '複製網址',
        copied: '已複製，貼到 Safari 開啟',
        lineNotice: '你正在 LINE 裡開啟 GymPro。這裡不能加到主畫面，Google 登入也可能被擋，建議改用 Safari 開啟。',
        inAppNotice: '你正在 App 的內建瀏覽器裡開啟 GymPro。這裡不能加到主畫面，Google 登入也可能被擋。點右上角的「⋯」，選「在 Safari 中開啟」。',
    },
    en: {
        installed: 'GymPro is already on your home screen. Open it from the GymPro icon there.',
        safari: ["Tap Safari's Share button (a box with an arrow); if you don't see it, tap ⋯ and then Share", 'Scroll down and choose Add to Home Screen', 'Tap Add in the top-right corner'],
        otherIos: ['Tap the Share button by the address bar, or Share in the ⋯ menu', 'Choose Add to Home Screen', 'Tap Add in the top-right corner'],
        otherIosNote: 'This needs iOS 16.4 or later. If Add to Home Screen is missing, open the page in Safari.',
        line: "LINE's own browser can't add a page to the home screen. Open GymPro in Safari, log in, then follow the steps there.",
        inApp: "This app's own browser can't add a page to the home screen. Tap ⋯ in the top-right corner and choose Open in Safari (or Open in browser), log in, then follow the steps there.",
        other: "Choose Add to Home Screen or Install app from your phone browser's menu. On an iPhone, use Safari.",
        openSafari: 'Open in Safari',
        copy: 'Copy the link',
        copied: 'Copied: paste it into Safari',
        lineNotice: "You're in LINE's own browser. It can't add GymPro to your home screen, and Google sign-in may be blocked here, so open GymPro in Safari.",
        inAppNotice: "You're in an app's own browser. It can't add GymPro to your home screen, and Google sign-in may be blocked here. Tap ⋯ in the top-right corner and choose Open in Safari.",
    },
}

const subscribeNothing = () => () => {}

/** The browser this page is open in; null while rendering on the server, so nothing mismatches */
export function useBrowserEnv(): BrowserEnv | null {
    return useSyncExternalStore(subscribeNothing, currentBrowserEnv, () => null)
}

/**
 * The guide itself. leaveTo: the page to open outside LINE; signed in, Safari has no session
 * yet, so it opens the login page rather than one that would only redirect.
 */
export function InstallGuide({ zh, leaveTo = '/login' }: { zh: boolean; leaveTo?: string }) {
    const env = useBrowserEnv()
    const text = zh ? TEXT.zh : TEXT.en
    if (!env) return null
    if (env === 'installed') return <p className="text-[13px] text-good">✓ {text.installed}</p>
    if (env === 'line') return <div className="space-y-2"><p className="text-[13px] text-muted">{text.line}</p><LeaveButtons zh={zh} to={leaveTo} /></div>
    if (env === 'in_app') return <p className="text-[13px] text-muted">{text.inApp}</p>
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

/** On the welcome, sign-up and log-in pages: in LINE or another app's browser, say to leave it first */
export function InAppBrowserNotice({ zh }: { zh: boolean }) {
    const env = useBrowserEnv()
    const text = zh ? TEXT.zh : TEXT.en
    if (env !== 'line' && env !== 'in_app') return null
    return (
        <div role="note" className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-ink">
            <p>{env === 'line' ? text.lineNotice : text.inAppNotice}</p>
            {env === 'line' && <LeaveButtons zh={zh} to={null} />}
        </div>
    )
}

/** Out of LINE: its own parameter opens the page in the phone's browser; copying the link is the fallback */
function LeaveButtons({ zh, to }: { zh: boolean; to: string | null }) {
    const text = zh ? TEXT.zh : TEXT.en
    const [copied, setCopied] = useState(false)
    const target = () => (to ? new URL(to, window.location.origin).toString() : window.location.href)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(target())
            setCopied(true)
        } catch {
            // No clipboard access: the link is still shown to copy by hand
            window.prompt?.(text.copy, target())
        }
    }
    return (
        <div className="flex flex-wrap gap-2">
            <a href={externalBrowserUrl(target())}
                className="inline-flex min-h-10 items-center rounded-lg bg-plate px-3 text-sm font-semibold text-chalk dark:bg-chalk dark:text-plate">
                {text.openSafari}
            </a>
            <button type="button" onClick={copy}
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-medium">
                {copied ? text.copied : text.copy}
            </button>
        </div>
    )
}
