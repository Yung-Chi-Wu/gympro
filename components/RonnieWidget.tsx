'use client'

import { useState, useRef, useEffect } from 'react'
import type { DisplayItem, ProposalCard, ProposalStatus, RecommendationCard } from '@/lib/ronnie/conversation'
import { describeProposal } from '@/lib/ronnie/events'
import { isSubmitEnter } from '@/lib/keyboard'

// Ronnie's chat window. The conversation lives on the server (one per day); this
// shows it, sends one message at a time, and handles the cards' buttons:
//   proposal: Confirm applies a routine change - a removal asks a second time first
//   recommendation: Add to today
// Each button's outcome is recorded in the conversation by the server, so Ronnie knows.

interface RonnieWidgetProps {
    language: string
    userId: string
}

// An error line is shown here only; it isn't part of the stored conversation
type Item = DisplayItem | { kind: 'error'; text: string }

const ACCENT = '#C8955A'

export function RonnieWidget({ language }: RonnieWidgetProps) {
    const zh = language === 'zh-TW'
    const [isOpen, setIsOpen] = useState(false)
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

    async function open() {
        setIsOpen(true)
        if (loaded) return
        try {
            const res = await fetch('/api/ai/coach')
            const data = await res.json().catch(() => null)
            if (res.ok && Array.isArray(data?.items)) setItems(data.items)
            setLoaded(true)
        } catch (err) {
            console.error(err)
        }
    }

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
                body: JSON.stringify({ exerciseId: rec.exerciseId, language }),
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

    function renderRecommendation(rec: RecommendationCard) {
        const added = addedToday.has(rec.exerciseId)
        return (
            <div key={rec.exerciseId} className="mt-2 rounded-xl border border-ink/10 dark:border-white/10 p-3 text-xs flex items-center justify-between gap-2">
                <span>💡 {rec.exerciseName}</span>
                {added ? (
                    <span className="text-ink/50 dark:text-white/50">{zh ? '已加入 ✓' : 'Added ✓'}</span>
                ) : (
                    <button type="button" disabled={busyCard === rec.exerciseId} onClick={() => addRecommendation(rec)}
                        className="px-3 py-1 rounded-lg text-white disabled:opacity-50 shrink-0" style={{ backgroundColor: ACCENT }}>
                        {zh ? '加入今天' : 'Add to today'}
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
            {/* 懸浮按鈕 */}
            {!isOpen && (
                <button
                    type="button"
                    onClick={open}
                    className="fixed bottom-24 right-4 sm:bottom-8 sm:right-8 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ backgroundColor: ACCENT }}
                    aria-label="Open Ronnie"
                >
                    <span className="text-white font-bold text-lg">R</span>
                </button>
            )}

            {/* Chat Widget */}
            {isOpen && (
                <div className="fixed bottom-24 right-4 sm:bottom-8 sm:right-8 z-50 w-[340px] sm:w-[380px] h-[520px] rounded-2xl bg-white dark:bg-[#2C2923] shadow-2xl flex flex-col overflow-hidden border border-ink/10 dark:border-white/10">

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
                            <button type="button" onClick={() => setIsOpen(false)}
                                className="text-white/50 hover:text-white transition-colors text-lg">
                                ✕
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
                </div>
            )}
        </>
    )
}
