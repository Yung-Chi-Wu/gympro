'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslations } from 'next-intl'
import { MAX_MESSAGE_CHARS, withoutCitationNumbers, type DisplayItem, type PlanCard, type ProposalCard, type ProposalStatus, type RecommendationCard } from '@/lib/ronnie/conversation'
import { describeProposal } from '@/lib/ronnie/events'
import { reportClientError, responseError } from '@/lib/report-client-error'
import { MAX_REPORT_NOTE_CHARS, REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '@/lib/feedback'
import { dataChanged, serverWrite } from '@/lib/data-version'
import { isSubmitEnter, useKeyboardOpen, useVisibleViewport, type VisibleViewport } from '@/lib/keyboard'
import { CoachGResult } from './CoachGResult'
import { Icon } from './Icon'

// Ronnie's chat window. The conversation lives on the server (one per day); this
// shows it, sends one message at a time, and handles the cards' buttons:
//   proposal: Confirm applies a routine change - a removal asks a second time first
//   recommendation: Add to today, or Swap (removes the exercise it replaces and adds it)
//   plan: View plan opens Coach G's editor with the week Coach G's planner built; saving
//     there replaces the routines and cycle, as Coach G's own does
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
/** The character count shows from here, so the limit doesn't come as a surprise */
const SHOW_COUNT_FROM = 1500
/** After Stop: the server stops between steps and saves what was done; then the window reloads it */
const RELOAD_AFTER_STOP_MS = 2000

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
    // Replies the user reported this session; the server keeps the flag on the reply's trace
    const [reported, setReported] = useState<Set<string>>(() => new Set())
    // The reply being reported, with what the user picked and wrote about it so far
    const [reporting, setReporting] = useState<{ traceId: string; reasons: ReportReason[]; note: string; sending: boolean; failed: boolean } | null>(null)
    const [editingText, setEditingText] = useState('')
    const [busyCard, setBusyCard] = useState<string | null>(null)
    // The removal waiting for its second confirmation
    const [confirming, setConfirming] = useState<ProposalCard | null>(null)
    const [addedToday, setAddedToday] = useState<Set<string>>(new Set())
    // The plan card whose routines are open in Coach G's editor, and the cards saved since the window loaded
    const [openPlan, setOpenPlan] = useState<PlanCard | null>(null)
    const [savedHere, setSavedHere] = useState<Set<string>>(new Set())
    // Replies whose source list is open, by their place in the chat
    const [openSources, setOpenSources] = useState<Set<number>>(() => new Set())
    const abortRef = useRef<AbortController | null>(null)
    // Counts the messages sent: a reload that started before one would show the conversation without it
    const sentRef = useRef(0)
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [items, isOpen, isLoading])

    const errorText = zh ? '發生錯誤，請再試一次。' : 'Something went wrong.'
    // Trying again won't help a message that's too long, so it gets its own line
    const tooLongText = zh ? `訊息太長了，最多 ${MAX_MESSAGE_CHARS} 字。` : `That message is too long; the limit is ${MAX_MESSAGE_CHARS} characters.`
    // Past the spend limits (lib/ai/spend-limits.ts): what happened and when it's back, not "try again"
    const limitText = (reason: unknown, resetsAt: unknown) => {
        if (reason === 'busy') return zh ? 'Ronnie 還在回上一則，等幾秒再傳一次。' : 'Ronnie is still on your last message; send this again in a few seconds.'
        const at = typeof resetsAt === 'string' ? new Date(resetsAt) : null
        const time = at?.toLocaleTimeString(zh ? 'zh-TW' : 'en-US', { hour: 'numeric', minute: '2-digit' })
        const day = at && at.toDateString() !== new Date().toDateString() ? (zh ? '明天' : 'tomorrow') : (zh ? '今天' : 'today')
        const when = time ? (zh ? `${day}${time}` : `${day} at ${time}`) : (zh ? '晚一點' : 'later')
        return reason === 'all'
            ? (zh ? `Ronnie 暫停到${when}。\n記錄訓練不受影響。` : `Ronnie is paused until ${when}.\nLogging workouts still works.`)
            : (zh ? `AI 額度暫時用完了，${when}恢復。\n記錄訓練不受影響。` : `You've used your AI allowance for now; it's back ${when}.\nLogging workouts still works.`)
    }
    const focusInput = () => setTimeout(() => inputRef.current?.focus(), 50)
    const notifyDashboard = () => {
        // Counted here too: after a stop, Ronnie's change may land on the server after the request ended
        dataChanged()
        window.dispatchEvent(new CustomEvent('ronnie-workout-changed'))
        window.dispatchEvent(new CustomEvent('ronnie-routine-changed'))
    }

    // The conversation loads the first time Ronnie opens, from the button or the sidebar. Nothing is
    // sent until it has (handleSend), since it replaces what the window shows; if it fails, the chat
    // still works, without the earlier messages.
    useEffect(() => {
        if (!isOpen || loaded) return
        let cancelled = false
        async function load() {
            try {
                const res = await fetch('/api/ai/coach')
                const data = await res.json().catch(() => null)
                if (cancelled) return
                if (res.ok && Array.isArray(data?.items)) setItems(data.items)
                else reportClientError('client/ronnie/load', responseError(`Conversation request failed: ${res.status}`, res.status, data))
            } catch (err) {
                console.error(err)
                reportClientError('client/ronnie/load', err)
            } finally {
                if (!cancelled) setLoaded(true)
            }
        }
        void load()
        return () => { cancelled = true }
    }, [isOpen, loaded])

    async function send(text: string, editFrom?: number) {
        sentRef.current++
        setIsLoading(true)
        abortRef.current = new AbortController()
        try {
            const signal = abortRef.current.signal
            const res = await serverWrite(() => fetch('/api/ai/coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, language, ...(editFrom === undefined ? {} : { editFrom }) }),
                signal,
            }))
            const data = await res.json().catch(() => null)
            if (res.status === 413) {
                setItems((prev) => [...prev, { kind: 'error', text: tooLongText }])
                return
            }
            if (res.status === 429) {
                setItems((prev) => [...prev, { kind: 'error', text: limitText(data?.reason, data?.resetsAt) }])
                return
            }
            // An error response has no message: show the error line instead of an empty reply
            if (!res.ok || typeof data?.message !== 'string' || !data.message.trim()) {
                throw responseError(`Ronnie request failed: ${res.status} ${data?.error ?? ''}`, res.status, data)
            }
            setItems((prev) => [...prev, {
                kind: 'assistant',
                text: data.message,
                ...(typeof data.traceId === 'string' ? { traceId: data.traceId, at: data.at } : {}),
                ...(data.proposals?.length ? { proposals: data.proposals } : {}),
                ...(data.recommendations?.length ? { recommendations: data.recommendations } : {}),
                ...(data.plans?.length ? { plans: data.plans } : {}),
                ...(data.sources?.length ? { sources: data.sources } : {}),
                ...(data.unsourced ? { unsourced: true } : {}),
            }])
            if (data.reloadDashboard) notifyDashboard()
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return
            console.error(err)
            reportClientError('client/ronnie/send', err)
            setItems((prev) => [...prev, { kind: 'error', text: errorText }])
        } finally {
            setIsLoading(false)
            focusInput()
        }
    }

    function handleSend(text?: string) {
        const content = text ?? input.trim()
        if (!content || isLoading || !loaded) return
        setItems((prev) => [...prev, { kind: 'user', text: content }])
        setInput('')
        focusInput()
        void send(content)
    }

    function handleStop() {
        abortRef.current?.abort()
        setIsLoading(false)
        focusInput()
        // A change Ronnie made before the stop is kept on the server: show it, and refresh today's workout.
        // Not over a message sent since: its reply brings the window up to date, and the conversation
        // read now could be from before it.
        const sent = sentRef.current
        setTimeout(async () => {
            try {
                const res = await fetch('/api/ai/coach')
                const data = await res.json().catch(() => null)
                if (res.ok && Array.isArray(data?.items)) { if (sentRef.current === sent) setItems(data.items) }
                else reportClientError('client/ronnie/reload', responseError(`Conversation request failed: ${res.status}`, res.status, data))
                notifyDashboard()
            } catch (err) {
                console.error(err)
                reportClientError('client/ronnie/reload', err)
            }
        }, RELOAD_AFTER_STOP_MS)
    }

    function handleEditSubmit(index: number) {
        const content = editingText.trim()
        // Not while a reply is coming: resending cuts the conversation at this message
        if (!content || isLoading) return
        // The server counts the user's messages, not the window's items
        const userIndex = items.slice(0, index).filter((it) => it.kind === 'user').length
        setItems((prev) => [...prev.slice(0, index), { kind: 'user', text: content }])
        setEditingIndex(null)
        setEditingText('')
        void send(content, userIndex)
    }

    async function handleClear() {
        // Deleted on the server, cards not yet confirmed with it, so it's asked first
        if (!confirm(zh ? '要清除今天的對話嗎？還沒確認的卡片也會一起消失。' : "Clear today's conversation? Cards you haven't confirmed go with it.")) return
        setItems([])
        setAddedToday(new Set())
        setSavedHere(new Set())
        await serverWrite(() => fetch('/api/ai/coach', { method: 'DELETE' })).catch(() => null)
    }

    const setCardStatus = (id: string, status: ProposalStatus) =>
        setItems((prev) => prev.map((it) => it.kind === 'assistant' && it.proposals?.some((p) => p.id === id)
            ? { ...it, proposals: it.proposals.map((p) => (p.id === id ? { ...p, status } : p)) }
            : it))

    async function resolve(card: ProposalCard, decision: 'confirm' | 'cancel') {
        setConfirming(null)
        setBusyCard(card.id)
        try {
            const res = await serverWrite(() => fetch('/api/ai/coach/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionId: card.id, decision, language }),
            }))
            const data = await res.json().catch(() => null)
            if (!res.ok || !data?.status) throw responseError(`Action failed: ${res.status}`, res.status, data)
            setCardStatus(card.id, data.status)
            if (data.text) setItems((prev) => [...prev, { kind: 'event', text: data.text }])
            if (data.reloadDashboard) notifyDashboard()
        } catch (err) {
            console.error(err)
            reportClientError('client/ronnie/action', err)
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
            const res = await serverWrite(() => fetch('/api/ai/coach/recommendations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exerciseId: rec.exerciseId, replacesExerciseId: rec.replacesExerciseId, language }),
            }))
            const data = await res.json().catch(() => null)
            if (!res.ok || !data?.status) throw responseError(`Add failed: ${res.status}`, res.status, data)
            setAddedToday((prev) => new Set(prev).add(rec.exerciseId))
            if (data.text) setItems((prev) => [...prev, { kind: 'event', text: data.text }])
            if (data.reloadDashboard) notifyDashboard()
        } catch (err) {
            console.error(err)
            reportClientError('client/ronnie/add-recommendation', err)
            setItems((prev) => [...prev, { kind: 'error', text: errorText }])
        } finally {
            setBusyCard(null)
        }
    }

    // Saved in Coach G's editor: the routines and cycle are new, and the conversation says so
    async function planSaved(card: PlanCard) {
        setOpenPlan(null)
        setSavedHere((prev) => new Set(prev).add(card.id))
        notifyDashboard()
        try {
            const res = await serverWrite(() => fetch('/api/ai/coach/plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId: card.id, language }),
            }))
            const data = await res.json().catch(() => null)
            if (!res.ok) throw responseError(`Plan event failed: ${res.status}`, res.status, data)
            if (data?.text) setItems((prev) => [...prev, { kind: 'event', text: data.text, planId: card.id }])
        } catch (err) {
            // The routines are saved; only Ronnie's note of it is missing
            console.error(err)
            reportClientError('client/ronnie/plan-saved', err)
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

    /**
     * The papers a reply cites, under it, each linking to the paper; and the line for general advice
     * no paper backs. Both written by code (lib/ronnie/citations.ts). The list is one line until
     * opened, and the reply's [1] markers aren't shown: a reply with many tips carried a number after
     * each and a long list under it, which the owner found cluttered (2026-10-21). The stored reply
     * keeps them, so Ronnie still reads which sentence came from which paper.
     */
    function renderSources(item: Extract<Item, { kind: 'assistant' }>, i: number) {
        if (!item.sources?.length && !item.unsourced) return null
        const open = openSources.has(i)
        const n = item.sources?.length ?? 0
        return (
            <div className="mt-2 space-y-1 border-t border-ink/10 pt-1.5 text-[11px] leading-snug text-ink/60 max-md:text-xs dark:border-white/10 dark:text-white/60">
                {n > 0 && (
                    <>
                        <button type="button" aria-expanded={open} className="underline underline-offset-2"
                            onClick={() => setOpenSources((prev) => {
                                const next = new Set(prev)
                                if (!next.delete(i)) next.add(i)
                                return next
                            })}>
                            {open ? (zh ? '收起出處' : 'Hide sources') : (zh ? `查看 ${n} 篇出處` : `See ${n} source${n > 1 ? 's' : ''}`)}
                        </button>
                        {open && (
                            <ul className="space-y-0.5">
                                {item.sources!.map((src) => (
                                    <li key={src.n}>
                                        <a href={`https://doi.org/${src.doi}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{src.citation}</a>
                                        {', '}{src.journal}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
                {item.unsourced && (item.sources?.length
                    ? <p>{zh ? '部分內容是一般建議，沒有附研究出處。' : 'Some of this is general advice, with no research source attached.'}</p>
                    : <p>{zh ? '這則回覆是一般建議，沒有附研究出處。' : 'This is general advice, with no research source attached.'}</p>)}
            </div>
        )
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

    // The week in one line, and a button to Coach G's editor; saving there replaces the routines
    function renderPlan(card: PlanCard) {
        const saved = savedHere.has(card.id) || items.some((it) => it.kind === 'event' && it.planId === card.id)
        const names = card.routines.map((r) => ((zh && r.name_zh_tw) || r.name).split(/[ （(]/)[0])
        const days = card.routines.reduce((n, r) => n + r.day_indices.length, 0)
        return (
            <div key={card.id} className="mt-2 rounded-xl border border-ink/10 dark:border-white/10 p-3 text-xs space-y-2">
                <p className="font-semibold">{zh ? '📋 Coach G 排好的課表' : "📋 Coach G's plan"}</p>
                <p>{zh ? `每週 ${days} 天：${names.join('、')}` : `${days} days a week: ${names.join(', ')}`}</p>
                {saved ? (
                    <p className="text-ink/50 dark:text-white/50">{zh ? '已存入 ✓' : 'Saved ✓'}</p>
                ) : (
                    <>
                        <p className="text-ink/50 dark:text-white/50">
                            {zh ? '可以先修改再存。存入後會取代你目前的課表和訓練循環。' : 'You can edit it first. Saving replaces your current routines and training cycle.'}
                        </p>
                        <div className="flex justify-end">
                            <button type="button" onClick={() => setOpenPlan(card)}
                                className="px-3 py-1 rounded-lg text-white" style={{ backgroundColor: ACCENT }}>
                                {zh ? '看課表' : 'View plan'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        )
    }

    // "Report a mistake" under a reply opens a short form: what was wrong (any of the reasons, or
    // words of their own, or both), sent with the reply's trace (lib/feedback.ts)
    const sendReport = async () => {
        if (!reporting || reporting.sending) return
        const { traceId, reasons, note } = reporting
        setReporting({ ...reporting, sending: true, failed: false })
        const res = await fetch('/api/ai/coach/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ traceId, reasons, note: note.trim() || null }),
        }).catch(() => null)
        if (res?.ok) {
            setReported((prev) => new Set(prev).add(traceId))
            setReporting(null)
        } else {
            setReporting((r) => (r ? { ...r, sending: false, failed: true } : r))
        }
    }
    const renderReport = (traceId: string) => (
        <div className="mt-0.5 flex justify-start px-1 text-[11px]">
            {reported.has(traceId) ? (
                <span className="text-ink/40 dark:text-white/40">{zh ? '已回報，對話將保留一年' : 'Reported; kept a year for review'}</span>
            ) : (
                <button type="button" onClick={() => setReporting({ traceId, reasons: [], note: '', sending: false, failed: false })}
                    className="-my-1 py-1 text-red-500/70 hover:text-red-500">
                    {zh ? '回報錯誤' : 'Report a mistake'}
                </button>
            )}
        </div>
    )

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
                        {/* Clear stays clear of ✕, whose tap area reaches past its icon */}
                        <div className="flex items-center gap-6">
                            {items.length > 0 && (
                                <button type="button" onClick={handleClear}
                                    className="min-h-11 px-2 text-xs text-white/40 hover:text-white/70 transition-colors md:min-h-9">
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
                        {!loaded && (
                            <p className="pt-4 text-center text-xs text-ink/50 dark:text-white/50">
                                {zh ? '載入對話中…' : 'Loading the conversation…'}
                            </p>
                        )}
                        {loaded && items.length === 0 && (
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
                                    <p key={i} className={`whitespace-pre-line text-center text-xs ${item.kind === 'error' ? 'text-red-500' : 'text-ink/50 dark:text-white/50'}`}>
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
                                                {renderContent(item.sources?.length ? withoutCitationNumbers(item.text) : item.text)}
                                                {renderSources(item, i)}
                                            </div>
                                            {item.proposals?.map(renderProposal)}
                                            {item.recommendations?.map(renderRecommendation)}
                                            {item.plans?.map(renderPlan)}
                                            {item.traceId && renderReport(item.traceId)}
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
                                                    maxLength={MAX_MESSAGE_CHARS}
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
                                maxLength={MAX_MESSAGE_CHARS}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (isSubmitEnter(e) && !isLoading) handleSend()
                                }}
                                placeholder={zh ? '問 Ronnie...' : 'Ask Ronnie...'}
                                className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent"
                            />
                            <button type="button" onClick={() => handleSend()}
                                disabled={!input.trim() || isLoading || !loaded}
                                className="rounded-xl px-3 py-2 text-sm font-medium text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: ACCENT }}>
                                {zh ? '發送' : 'Send'}
                            </button>
                        </div>
                        {input.length >= SHOW_COUNT_FROM && (
                            <p className={`mt-1 text-right text-xs tabular-nums ${input.length >= MAX_MESSAGE_CHARS ? 'text-red-500' : 'text-ink/40 dark:text-white/40'}`}>
                                {input.length} / {MAX_MESSAGE_CHARS}
                            </p>
                        )}
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

                    {/* Report a mistake: what was wrong with the reply */}
                    {reporting && (
                        <div className="absolute inset-0 flex items-end bg-black/40 p-3" role="dialog" aria-modal="true" aria-labelledby="report-title"
                            onKeyDown={(e) => { if (e.key === 'Escape') setReporting(null) }}>
                            <div className="w-full space-y-3 rounded-2xl bg-white p-4 shadow-xl dark:bg-[#2C2923]">
                                <p id="report-title" className="text-sm font-semibold">{zh ? '這則回覆哪裡有問題？' : 'What was wrong with this reply?'}</p>
                                <div className="flex flex-wrap gap-2">
                                    {REPORT_REASONS.map((reason) => {
                                        const picked = reporting.reasons.includes(reason)
                                        return (
                                            <button key={reason} type="button" aria-pressed={picked}
                                                onClick={() => setReporting({ ...reporting, reasons: picked ? reporting.reasons.filter((r) => r !== reason) : [...reporting.reasons, reason] })}
                                                className={`min-h-9 rounded-full border px-3 text-xs ${picked ? 'border-transparent bg-ink text-card dark:bg-white dark:text-[#2C2923]' : 'border-ink/20 dark:border-white/20'}`}>
                                                {REPORT_REASON_LABELS[zh ? 'zh-TW' : 'en'][reason]}
                                            </button>
                                        )
                                    })}
                                </div>
                                <textarea
                                    value={reporting.note}
                                    onChange={(e) => setReporting({ ...reporting, note: e.target.value })}
                                    maxLength={MAX_REPORT_NOTE_CHARS}
                                    rows={3}
                                    aria-label={zh ? '補充說明' : 'Details'}
                                    placeholder={zh ? '想補充什麼？（選填）' : 'Anything to add? (optional)'}
                                    className="w-full rounded-xl border border-ink/20 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                                />
                                <p className="text-[11px] text-ink/50 dark:text-white/50">
                                    {zh ? '送出後，這段對話會保留一年，讓我們檢查哪裡出錯。' : "This conversation is kept for a year, so we can check what went wrong."}
                                </p>
                                {reporting.failed && (
                                    <p role="alert" className="text-xs text-red-500">{zh ? '沒有送出，請再試一次。' : "It wasn't sent. Try again."}</p>
                                )}
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setReporting(null)}
                                        className="min-h-9 rounded-lg border border-ink/20 px-3 text-xs dark:border-white/20">
                                        {zh ? '取消' : 'Cancel'}
                                    </button>
                                    <button type="button" onClick={sendReport}
                                        disabled={reporting.sending || (!reporting.reasons.length && !reporting.note.trim())}
                                        className="min-h-9 rounded-lg px-3 text-xs font-medium text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
                                        {reporting.sending ? (zh ? '送出中…' : 'Sending…') : (zh ? '送出' : 'Send')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </aside>
            )}

            {/* A plan card's routines in Coach G's editor, over the page as Coach G's own opens */}
            {openPlan && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-lg h-[85vh] rounded-xl bg-white dark:bg-[#2C2923] shadow-xl flex flex-col overflow-hidden">
                        <CoachGResult
                            routines={openPlan.routines}
                            cycleLength={openPlan.cycleLength}
                            language={language}
                            onBack={() => setOpenPlan(null)}
                            onSaved={() => void planSaved(openPlan)}
                            backLabel={zh ? '關閉' : 'Close'}
                        />
                    </div>
                </div>
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
    // 53px: the top bar with its line; --tab-bar-top: the tab bar's top edge (globals.css); a gap above and below
    return {
        ...base,
        bottom: `calc(var(--tab-bar-top) + ${GAP}px)`,
        height: `min(${WINDOW_MAX_HEIGHT}px, calc(100dvh - 53px - var(--tab-bar-top) - ${2 * GAP}px - env(safe-area-inset-top)))`,
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
            // 60px: the top bar and a gap; at the bottom, the tab bar's top edge, a gap and the button
            top: `clamp(calc(60px + env(safe-area-inset-top)), ${spot.top}px, calc(100dvh - var(--tab-bar-top) - ${8 + BUTTON_SIZE}px))`,
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
