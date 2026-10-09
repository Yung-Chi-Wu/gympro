'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import type { DisplayItem, ProposalCard, ProposalStatus, RecommendationCard } from '@/lib/ronnie/conversation'
import { describeProposal } from '@/lib/ronnie/events'
import { isSubmitEnter, useKeyboardOpen, useVisibleViewport, type VisibleViewport } from '@/lib/keyboard'
import { Icon } from './Icon'

// Ronnie's chat window. The conversation lives on the server (one per day); this
// shows it, sends one message at a time, and handles the cards' buttons:
//   proposal: Confirm applies a routine change - a removal asks a second time first
//   recommendation: Add to today, or Swap (removes the exercise it replaces and adds it)
// Each button's outcome is recorded in the conversation by the server, so Ronnie knows.
//
// Where it sits: on a phone, a round button the user can drag to either edge opens the
// chat as a small floating window on that side, just above the tab bar. The page stays
// visible and usable behind it (Ronnie's changes show up in the logging card as they
// happen); only ✕ closes it. From md up there is no button: 問 Ronnie in the sidebar opens
// the chat as a column on the right, which narrows the page instead of covering it.

interface RonnieState {
    isOpen: boolean
    open: () => void
    close: () => void
    toggle: () => void
}

const RonnieContext = createContext<RonnieState | null>(null)

/** Whether Ronnie is open, shared by the widget and the sidebar's 問 Ronnie */
export function RonnieProvider({ children }: { children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)
    const open = useCallback(() => setIsOpen(true), [])
    const close = useCallback(() => setIsOpen(false), [])
    const toggle = useCallback(() => setIsOpen((v) => !v), [])
    const value = useMemo(() => ({ isOpen, open, close, toggle }), [isOpen, open, close, toggle])
    return <RonnieContext.Provider value={value}>{children}</RonnieContext.Provider>
}

export function useRonnie(): RonnieState {
    const state = useContext(RonnieContext)
    if (!state) throw new Error('useRonnie needs a RonnieProvider')
    return state
}

interface RonnieWidgetProps {
    language: string
    userId: string
}

// An error line is shown here only; it isn't part of the stored conversation
type Item = DisplayItem | { kind: 'error'; text: string }

const ACCENT = '#C8955A'

export function RonnieWidget({ language }: RonnieWidgetProps) {
    const zh = language === 'zh-TW'
    const { isOpen, open: setOpen, close } = useRonnie()
    const tNav = useTranslations('nav')
    const isPhone = useIsPhone()
    const spot = useButtonSpot()
    const viewport = useVisibleViewport()
    const [items, setItems] = useState<Item[]>([])
    const [loaded, setLoaded] = useState(false)
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [editingText, setEditingText] = useState('')
    const [busyCard, setBusyCard] = useState<string | null>(null)
    // The removal waiting for its second confirmation
    const [confirming, setConfirming] = useState<ProposalCard | null>(null)
    const [addedToday, setAddedToday] = useState<Set<string>>(new Set())
    const abortRef = useRef<AbortController | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [items, isOpen, isLoading])

    const errorText = zh ? '發生錯誤，請再試一次。' : 'Something went wrong.'
    const focusInput = () => setTimeout(() => inputRef.current?.focus(), 50)
    const notifyDashboard = () => {
        window.dispatchEvent(new CustomEvent('ronnie-workout-changed'))
        window.dispatchEvent(new CustomEvent('ronnie-routine-changed'))
    }

    // The conversation loads the first time Ronnie opens, from the button or the sidebar
    useEffect(() => {
        if (!isOpen || loaded) return
        let cancelled = false
        async function load() {
            try {
                const res = await fetch('/api/ai/coach')
                const data = await res.json().catch(() => null)
                if (cancelled) return
                if (res.ok && Array.isArray(data?.items)) setItems(data.items)
                setLoaded(true)
            } catch (err) {
                console.error(err)
            }
        }
        void load()
        return () => { cancelled = true }
    }, [isOpen, loaded])

    async function send(text: string, editFrom?: number) {
        setIsLoading(true)
        abortRef.current = new AbortController()
        try {
            const res = await fetch('/api/ai/coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, language, ...(editFrom === undefined ? {} : { editFrom }) }),
                signal: abortRef.current.signal,
            })
            const data = await res.json().catch(() => null)
            // An error response has no message: show the error line instead of an empty reply
            if (!res.ok || typeof data?.message !== 'string' || !data.message.trim()) {
                throw new Error(`Ronnie request failed: ${res.status} ${data?.error ?? ''}`)
            }
            setItems((prev) => [...prev, {
                kind: 'assistant',
                text: data.message,
                ...(data.proposals?.length ? { proposals: data.proposals } : {}),
                ...(data.recommendations?.length ? { recommendations: data.recommendations } : {}),
            }])
            if (data.reloadDashboard) notifyDashboard()
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return
            console.error(err)
            setItems((prev) => [...prev, { kind: 'error', text: errorText }])
        } finally {
            setIsLoading(false)
            focusInput()
        }
    }

    function handleSend(text?: string) {
        const content = text ?? input.trim()
        if (!content || isLoading) return
        setItems((prev) => [...prev, { kind: 'user', text: content }])
        setInput('')
        focusInput()
        void send(content)
    }

    function handleStop() {
        abortRef.current?.abort()
        setIsLoading(false)
        focusInput()
    }

    function handleEditSubmit(index: number) {
        const content = editingText.trim()
        if (!content) return
        // The server counts the user's messages, not the window's items
        const userIndex = items.slice(0, index).filter((it) => it.kind === 'user').length
        setItems((prev) => [...prev.slice(0, index), { kind: 'user', text: content }])
        setEditingIndex(null)
        setEditingText('')
        void send(content, userIndex)
    }

    async function handleClear() {
        setItems([])
        setAddedToday(new Set())
        await fetch('/api/ai/coach', { method: 'DELETE' }).catch(() => null)
    }

    const setCardStatus = (id: string, status: ProposalStatus) =>
        setItems((prev) => prev.map((it) => it.kind === 'assistant' && it.proposals?.some((p) => p.id === id)
            ? { ...it, proposals: it.proposals.map((p) => (p.id === id ? { ...p, status } : p)) }
            : it))

    async function resolve(card: ProposalCard, decision: 'confirm' | 'cancel') {
        setConfirming(null)
        setBusyCard(card.id)
        try {
            const res = await fetch('/api/ai/coach/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionId: card.id, decision, language }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok || !data?.status) throw new Error(`Action failed: ${res.status}`)
            setCardStatus(card.id, data.status)
            if (data.text) setItems((prev) => [...prev, { kind: 'event', text: data.text }])
            if (data.reloadDashboard) notifyDashboard()
        } catch (err) {
            console.error(err)
            setItems((prev) => [...prev, { kind: 'error', text: errorText }])
        } finally {
            setBusyCard(null)
        }
    }

    // A removal asks twice: the card's Confirm opens the dialog, the dialog applies it
    function handleConfirm(card: ProposalCard) {
        if (card.change === 'remove_exercise') setConfirming(card)
        else void resolve(card, 'confirm')
    }

    async function addRecommendation(rec: RecommendationCard) {
        setBusyCard(rec.exerciseId)
        try {
            const res = await fetch('/api/ai/coach/recommendations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exerciseId: rec.exerciseId, replacesExerciseId: rec.replacesExerciseId, language }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok || !data?.status) throw new Error(`Add failed: ${res.status}`)
            setAddedToday((prev) => new Set(prev).add(rec.exerciseId))
            if (data.text) setItems((prev) => [...prev, { kind: 'event', text: data.text }])
            if (data.reloadDashboard) notifyDashboard()
        } catch (err) {
            console.error(err)
            setItems((prev) => [...prev, { kind: 'error', text: errorText }])
        } finally {
            setBusyCard(null)
        }
    }

    function renderContent(text: string) {
        return text.split('\n').map((line, i, arr) => (
            <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
            </span>
        ))
    }

    function statusLabel(status: ProposalStatus | undefined) {
        if (status === 'confirmed') return zh ? '已套用 ✓' : 'Applied ✓'
        if (status === 'cancelled') return zh ? '已取消' : 'Cancelled'
        if (status === 'expired') return zh ? '已過期' : 'Expired'
        return null
    }

    function renderProposal(card: ProposalCard) {
        const removal = card.change === 'remove_exercise'
        const label = statusLabel(card.status)
        return (
            <div key={card.id} className="mt-2 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs space-y-2">
                <p className="font-semibold">{removal ? (zh ? '⚠️ 永久修改・待確認' : '⚠️ Permanent change · needs your OK') : (zh ? '課表修改・待確認' : 'Routine change · needs your OK')}</p>
                <p>{describeProposal(card, zh)}</p>
                {label ? (
                    <p className="text-ink/50 dark:text-white/50">{label}</p>
                ) : (
                    <div className="flex gap-2 justify-end">
                        <button type="button" disabled={busyCard === card.id} onClick={() => resolve(card, 'cancel')}
                            className="px-3 py-1 rounded-lg border border-ink/20 dark:border-white/20 disabled:opacity-50">
                            {zh ? '取消' : 'Cancel'}
                        </button>
                        <button type="button" disabled={busyCard === card.id} onClick={() => handleConfirm(card)}
                            className="px-3 py-1 rounded-lg text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                            {zh ? '確認' : 'Confirm'}
                        </button>
                    </div>
                )}
            </div>
        )
    }

    // A swap card says what goes out and what comes in; its button does both
    function renderRecommendation(rec: RecommendationCard) {
        const added = addedToday.has(rec.exerciseId)
        const swap = !!rec.replacesExerciseId
        return (
            <div key={rec.exerciseId} className="mt-2 rounded-xl border border-ink/10 dark:border-white/10 p-3 text-xs flex items-center justify-between gap-2">
                <span>{swap ? `🔄 ${rec.replacesName} → ${rec.exerciseName}` : `💡 ${rec.exerciseName}`}</span>
                {added ? (
                    <span className="text-ink/50 dark:text-white/50">{swap ? (zh ? '已替換 ✓' : 'Swapped ✓') : (zh ? '已加入 ✓' : 'Added ✓')}</span>
                ) : (
                    <button type="button" disabled={busyCard === rec.exerciseId} onClick={() => addRecommendation(rec)}
                        className="px-3 py-1 rounded-lg text-white disabled:opacity-50 shrink-0" style={{ backgroundColor: ACCENT }}>
                        {swap ? (zh ? '替換' : 'Swap') : (zh ? '加入今天' : 'Add to today')}
                    </button>
                )}
            </div>
        )
    }

    const avatar = (
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs mr-2 mt-1 shrink-0"
            style={{ backgroundColor: ACCENT }}>
            R
        </div>
    )

    return (
        <>
            {/* 手機：可以拖曳的圓形按鈕 */}
            {!isOpen && <RonnieButton label={tNav('openRonnie')} onOpen={setOpen} />}

            {/* 對話：手機是按鈕那一側的小視窗；md 以上是右邊一欄，主畫面跟著變窄 */}
            {isOpen && (
                <aside
                    aria-label="Ronnie"
                    style={isPhone ? windowStyle(spot.side, viewport) : undefined}
                    className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[0_12px_40px_rgb(0_0_0/0.25)] md:relative md:z-auto md:h-dvh md:w-[340px] md:shrink-0 md:rounded-none md:border-0 md:border-l md:shadow-none xl:w-[380px]"
                >

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ backgroundColor: '#26241F' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm"
                                style={{ backgroundColor: ACCENT }}>
                                R
                            </div>
                            <div>
                                <p className="font-semibold text-sm text-white">Ronnie</p>
                                <p className="text-xs text-white/50">
                                    {zh ? 'AI 隨身教練' : 'AI Personal Coach'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {items.length > 0 && (
                                <button type="button" onClick={handleClear}
                                    className="text-xs text-white/40 hover:text-white/70 transition-colors">
                                    {zh ? '清除' : 'Clear'}
                                </button>
                            )}
                            <button type="button" onClick={close} aria-label={tNav('closeRonnie')}
                                className="-m-3 p-3 text-white/50 hover:text-white transition-colors">
                                <Icon name="close" className="size-5" />
                            </button>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {items.length === 0 && (
                            <div className="text-center space-y-3 pt-4">
                                <div className="text-4xl">💪</div>
                                <p className="text-sm font-medium">{"Ain't nothin' but a peanut!"}</p>
                                <p className="text-xs text-ink/40 dark:text-white/40">
                                    {zh
                                        ? '問我任何健身問題，或讓我幫你調整今天的課表'
                                        : "Ask me anything about training, or let me help with today's workout"}
                                </p>
                                <div className="space-y-2 pt-2">
                                    {(zh ? [
                                        '今天我做了什麼？',
                                        '深蹲有什麼替代動作？',
                                        '怎麼使用 GymPro？',
                                    ] : [
                                        "What did I do today?",
                                        "Squat alternatives?",
                                        "How do I use GymPro?",
                                    ]).map((q) => (
                                        <button key={q} type="button" onClick={() => handleSend(q)}
                                            className="block w-full text-left rounded-xl border border-ink/10 dark:border-white/10 px-3 py-2 text-xs hover:bg-ink/5 dark:hover:bg-white/5 transition-colors">
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {items.map((item, i) => {
                            if (item.kind === 'event' || item.kind === 'error') {
                                return (
                                    <p key={i} className={`text-center text-xs ${item.kind === 'error' ? 'text-red-500' : 'text-ink/50 dark:text-white/50'}`}>
                                        {item.text}
                                    </p>
                                )
                            }
                            if (item.kind === 'assistant') {
                                return (
                                    <div key={i} className="flex justify-start">
                                        {avatar}
                                        <div className="max-w-[80%]">
                                            <div className="rounded-2xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed bg-ink/5 dark:bg-white/8">
                                                {renderContent(item.text)}
                                            </div>
                                            {item.proposals?.map(renderProposal)}
                                            {item.recommendations?.map(renderRecommendation)}
                                        </div>
                                    </div>
                                )
                            }
                            return (
                                <div key={i} className="flex justify-end group">
                                    <div className="relative max-w-[80%]">
                                        {editingIndex === i ? (
                                            <div className="space-y-1">
                                                <textarea
                                                    autoFocus
                                                    value={editingText}
                                                    onChange={(e) => setEditingText(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (isSubmitEnter(e) && !e.shiftKey) {
                                                            e.preventDefault()
                                                            handleEditSubmit(i)
                                                        }
                                                        if (e.key === 'Escape') setEditingIndex(null)
                                                    }}
                                                    className="w-full rounded-2xl px-3 py-2 text-sm bg-plate dark:bg-white text-chalk dark:text-[#1A1814] resize-none"
                                                    rows={2}
                                                />
                                                <div className="flex gap-1 justify-end">
                                                    <button type="button" onClick={() => setEditingIndex(null)}
                                                        className="text-xs text-ink/40 px-2 py-0.5">
                                                        {zh ? '取消' : 'Cancel'}
                                                    </button>
                                                    <button type="button" onClick={() => handleEditSubmit(i)}
                                                        className="text-xs bg-plate dark:bg-white text-chalk dark:text-[#1A1814] px-2 py-0.5 rounded-md">
                                                        {zh ? '重新送出' : 'Resend'}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="rounded-2xl rounded-tr-sm px-3 py-2 text-sm leading-relaxed bg-plate dark:bg-white text-chalk dark:text-[#1A1814]">
                                                    {renderContent(item.text)}
                                                </div>
                                                {!isLoading && (
                                                    <button
                                                        type="button"
                                                        onClick={() => { setEditingIndex(i); setEditingText(item.text) }}
                                                        className="absolute -left-6 top-1 opacity-0 group-hover:opacity-100 transition-opacity text-ink/30 hover:text-ink/60 text-xs"
                                                    >
                                                        ✎
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )
                        })}

                        {isLoading && (
                            <div className="flex justify-start items-center gap-2">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                                    style={{ backgroundColor: ACCENT }}>
                                    R
                                </div>
                                <div className="bg-ink/5 dark:bg-white/8 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3">
                                    <div className="flex gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: ACCENT, animationDelay: '0ms' }} />
                                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: ACCENT, animationDelay: '150ms' }} />
                                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: ACCENT, animationDelay: '300ms' }} />
                                    </div>
                                    <button type="button" onClick={handleStop}
                                        className="text-xs text-ink/40 hover:text-red-500 transition-colors">
                                        {zh ? '停止' : 'Stop'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 border-t border-ink/10 dark:border-white/10 shrink-0">
                        <div className="flex gap-2">
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (isSubmitEnter(e) && !isLoading) handleSend()
                                }}
                                placeholder={zh ? '問 Ronnie...' : 'Ask Ronnie...'}
                                className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent"
                            />
                            <button type="button" onClick={() => handleSend()}
                                disabled={!input.trim() || isLoading}
                                className="rounded-xl px-3 py-2 text-sm font-medium text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: ACCENT }}>
                                {zh ? '發送' : 'Send'}
                            </button>
                        </div>
                    </div>

                    {/* Second confirmation for a removal */}
                    {confirming && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-6" role="dialog" aria-modal="true">
                            <div className="w-full rounded-2xl bg-white dark:bg-[#2C2923] p-4 space-y-3 shadow-xl">
                                <p className="font-semibold text-sm">{zh ? '確定要永久移除嗎？' : 'Remove it for good?'}</p>
                                <p className="text-xs text-ink/70 dark:text-white/70">
                                    {zh
                                        ? `「${confirming.exerciseName}」會從${confirming.routineNames.map((n) => `「${n}」`).join('、')}移除，之後不會再排這個動作。`
                                        : `"${confirming.exerciseName}" will be removed from ${confirming.routineNames.join(', ')} and won't be scheduled again.`}
                                </p>
                                <div className="flex gap-2 justify-end">
                                    <button type="button" onClick={() => setConfirming(null)}
                                        className="px-3 py-1.5 rounded-lg border border-ink/20 dark:border-white/20 text-xs">
                                        {zh ? '返回' : 'Back'}
                                    </button>
                                    <button type="button" onClick={() => resolve(confirming, 'confirm')}
                                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs">
                                        {zh ? '確定移除' : 'Remove'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </aside>
            )}
        </>
    )
}

// ---------- The phone's window ----------

const PHONE_QUERY = '(max-width: 767.98px)'

function subscribePhone(listener: () => void) {
    const query = window.matchMedia(PHONE_QUERY)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
}

/** Below md, where Ronnie is a floating window instead of a column */
function useIsPhone(): boolean {
    return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false)
}

const WINDOW_WIDTH = 'min(360px, calc(100vw - 24px))'
const WINDOW_MAX_HEIGHT = 540
const GAP = 8

/**
 * Where the phone's chat window sits: on the side the button was left on, just above the
 * tab bar, as tall as fits between the top bar and the tab bar (at most 540px). With the
 * keyboard open the tab bar hides and the window fits the visible area instead, right
 * above the keyboard, so the input stays in view.
 */
function windowStyle(side: ButtonSpot['side'], viewport: VisibleViewport | null): React.CSSProperties {
    const base: React.CSSProperties = { [side]: '12px', width: WINDOW_WIDTH }
    if (viewport?.keyboardOpen) {
        const height = Math.min(WINDOW_MAX_HEIGHT, viewport.height - 2 * GAP)
        return { ...base, top: viewport.offsetTop + viewport.height - GAP - height, height }
    }
    // 53px: the top bar with its line; 56px: the tab bar; a gap above and below
    return {
        ...base,
        bottom: `calc(56px + ${GAP}px + env(safe-area-inset-bottom))`,
        height: `min(${WINDOW_MAX_HEIGHT}px, calc(100dvh - 53px - 56px - ${2 * GAP}px - env(safe-area-inset-top) - env(safe-area-inset-bottom)))`,
    }
}

// ---------- The phone's button ----------

const BUTTON_SIZE = 52
const EDGE = 16
/** A press that moves less than this is a tap, so a slightly shaky tap still opens the chat */
const DRAG_THRESHOLD = 6
const SPOT_KEY = 'gympro.ronnieButton'

interface ButtonSpot {
    side: 'left' | 'right'
    /** Top edge in px from the top of the screen; the CSS keeps it between the top bar and the tab bar */
    top: number
}

// The bottom right, just above the tab bar
const DEFAULT_SPOT: ButtonSpot = { side: 'right', top: 100_000 }

// Where the user left the button, kept in localStorage. Storage can be missing or refuse
// writes (private browsing); the spot is then remembered until the page reloads.
let savedSpot: string | null | undefined
const spotListeners = new Set<() => void>()

function getSpotSnapshot(): string | null {
    if (savedSpot === undefined) {
        try {
            savedSpot = localStorage.getItem(SPOT_KEY)
        } catch {
            savedSpot = null
        }
    }
    return savedSpot
}

function subscribeSpot(listener: () => void) {
    spotListeners.add(listener)
    return () => { spotListeners.delete(listener) }
}

function saveSpot(spot: ButtonSpot) {
    savedSpot = JSON.stringify(spot)
    try {
        localStorage.setItem(SPOT_KEY, savedSpot)
    } catch {
        // Kept in memory only
    }
    spotListeners.forEach((listener) => listener())
}

function parseSpot(raw: string | null): ButtonSpot {
    if (!raw) return DEFAULT_SPOT
    try {
        const v = JSON.parse(raw)
        if ((v?.side === 'left' || v?.side === 'right') && Number.isFinite(v?.top)) return { side: v.side, top: v.top }
    } catch {
        // Not a spot this version wrote: start over
    }
    return DEFAULT_SPOT
}

/** Where the user left the button; the chat window opens on the same side */
function useButtonSpot(): ButtonSpot {
    const raw = useSyncExternalStore(subscribeSpot, getSpotSnapshot, () => null)
    return useMemo(() => parseSpot(raw), [raw])
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max))

/**
 * The round button that opens Ronnie on a phone. It can be dragged anywhere between the
 * top bar and the tab bar; let go, it slides to the nearer side and stays there next time.
 * A press that barely moves is a tap and opens the chat. It hides while the keyboard is open.
 */
function RonnieButton({ label, onOpen }: { label: string; onOpen: () => void }) {
    const keyboardOpen = useKeyboardOpen()
    const spot = useButtonSpot()
    // While dragging: the button's top-left corner, in px
    const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null)
    const press = useRef<{
        id: number
        startX: number
        startY: number
        offsetX: number
        offsetY: number
        minY: number
        maxY: number
        x: number
        y: number
        moved: boolean
    } | null>(null)
    // A drag ends in a click too; that click mustn't open the chat
    const justDragged = useRef(false)

    if (keyboardOpen) return null

    function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
        if (e.button !== 0) return
        justDragged.current = false
        const rect = e.currentTarget.getBoundingClientRect()
        // The free area: below the phone's top bar, above its tab bar
        const bar = document.querySelector('[data-app-bar]')?.getBoundingClientRect()
        const tabs = document.querySelector('.bottom-nav')?.getBoundingClientRect()
        press.current = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            minY: (bar?.bottom ?? 0) + 8,
            maxY: (tabs?.top ?? window.innerHeight) - 8 - BUTTON_SIZE,
            x: rect.left,
            y: rect.top,
            moved: false,
        }
        e.currentTarget.setPointerCapture(e.pointerId)
    }

    function handlePointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
        const p = press.current
        if (!p || p.id !== e.pointerId) return
        if (!p.moved && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD) return
        p.moved = true
        p.x = clamp(e.clientX - p.offsetX, EDGE / 2, window.innerWidth - BUTTON_SIZE - EDGE / 2)
        p.y = clamp(e.clientY - p.offsetY, p.minY, p.maxY)
        setDragAt({ x: p.x, y: p.y })
    }

    function handlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
        const p = press.current
        if (!p || p.id !== e.pointerId) return
        press.current = null
        if (!p.moved) return
        justDragged.current = true
        saveSpot({ side: p.x + BUTTON_SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right', top: Math.round(p.y) })
        setDragAt(null)
    }

    function handlePointerCancel() {
        press.current = null
        setDragAt(null)
    }

    const style = dragAt
        ? { left: dragAt.x, top: dragAt.y, transition: 'none' }
        : {
            left: spot.side === 'left' ? `${EDGE}px` : `calc(100% - ${EDGE + BUTTON_SIZE}px)`,
            // 60px: the top bar and a gap; 116px: the tab bar, a gap and the button
            top: `clamp(calc(60px + env(safe-area-inset-top)), ${spot.top}px, calc(100dvh - 116px - env(safe-area-inset-bottom)))`,
        }

    return (
        <button
            type="button"
            aria-label={label}
            onClick={() => {
                if (justDragged.current) {
                    justDragged.current = false
                    return
                }
                onOpen()
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            style={style}
            className="fixed z-40 grid size-[52px] touch-none select-none place-items-center rounded-full bg-ink text-card shadow-[0_6px_18px_rgb(0_0_0/0.18)] transition-[left,top] duration-200 ease-out active:scale-95 md:hidden"
        >
            <Icon name="chat" className="size-6" />
        </button>
    )
}
