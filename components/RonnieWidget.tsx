'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface RonnieWidgetProps {
    language: string
    userId: string
}

const STORAGE_KEY_PREFIX = 'ronnie_chat_'

export function RonnieWidget({ language, userId }: RonnieWidgetProps) {
    const zh = language === 'zh-TW'
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [editingText, setEditingText] = useState('')
    const abortRef = useRef<AbortController | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const todayKey = `${STORAGE_KEY_PREFIX}${userId}_${new Date().toISOString().split('T')[0]}`

    // 載入今天的對話
    useEffect(() => {
        try {
            const saved = localStorage.getItem(todayKey)
            if (saved) setMessages(JSON.parse(saved))
        } catch { /* ignore */ }
    }, [todayKey])

    // reload 後重新開啟
    useEffect(() => {
        if (sessionStorage.getItem('ronnie_open') === 'true') {
            sessionStorage.removeItem('ronnie_open')
            setIsOpen(true)
        }
    }, [])

    // 儲存對話
    useEffect(() => {
        if (messages.length > 0) {
            try {
                localStorage.setItem(todayKey, JSON.stringify(messages))
            } catch { /* ignore */ }
        }
    }, [messages, todayKey])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isOpen, isLoading])

    const sendMessages = useCallback(async (msgs: Message[]) => {
        setIsLoading(true)
        abortRef.current = new AbortController()

        try {
            const res = await fetch('/api/ai/coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: msgs.map((m) => ({ role: m.role, content: m.content })),
                    language,
                }),
                signal: abortRef.current.signal,
            })
            const data = await res.json()
            setMessages((prev) => [...prev, { role: 'assistant', content: data.message }])

            if (data.reloadDashboard) {
                window.dispatchEvent(new CustomEvent('ronnie-workout-changed'))
                window.dispatchEvent(new CustomEvent('ronnie-routine-changed'))
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') return
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: zh ? '發生錯誤，請再試一次。' : 'Something went wrong.',
            }])
        } finally {
            setIsLoading(false)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [language, zh])

    async function handleSend(text?: string) {
        const content = text ?? input.trim()
        if (!content || isLoading) return

        const userMsg: Message = { role: 'user', content }
        const newMessages = [...messages, userMsg]
        setMessages(newMessages)
        setInput('')
        setTimeout(() => inputRef.current?.focus(), 50)

        await sendMessages(newMessages)
    }

    function handleStop() {
        abortRef.current?.abort()
        setIsLoading(false)
        setTimeout(() => inputRef.current?.focus(), 50)
    }

    function handleEditStart(index: number, content: string) {
        setEditingIndex(index)
        setEditingText(content)
    }

    async function handleEditSubmit(index: number) {
        if (!editingText.trim()) return
        const newMessages = [
            ...messages.slice(0, index),
            { role: 'user' as const, content: editingText.trim() },
        ]
        setMessages(newMessages)
        setEditingIndex(null)
        setEditingText('')
        await sendMessages(newMessages)
    }

    function handleClear() {
        setMessages([])
        localStorage.removeItem(todayKey)
    }

    function renderContent(text: string) {
        return text.split('\n').map((line, i, arr) => (
            <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
            </span>
        ))
    }

    return (
        <>
            {/* 懸浮按鈕 */}
            {!isOpen && (
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-24 right-4 sm:bottom-8 sm:right-8 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ backgroundColor: '#C8955A' }}
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
                                style={{ backgroundColor: '#C8955A' }}>
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
                            {messages.length > 0 && (
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
                        {messages.length === 0 && (
                            <div className="text-center space-y-3 pt-4">
                                <div className="text-4xl">💪</div>
                                <p className="text-sm font-medium">Ain't nothin' but a peanut!</p>
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

                        {messages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                                {msg.role === 'assistant' && (
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs mr-2 mt-1 shrink-0"
                                        style={{ backgroundColor: '#C8955A' }}>
                                        R
                                    </div>
                                )}
                                <div className="relative max-w-[80%]">
                                    {msg.role === 'user' && editingIndex === i ? (
                                        <div className="space-y-1">
                                            <textarea
                                                autoFocus
                                                value={editingText}
                                                onChange={(e) => setEditingText(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
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
                                            <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user'
                                                ? 'bg-plate dark:bg-white text-chalk dark:text-[#1A1814] rounded-tr-sm'
                                                : 'bg-ink/5 dark:bg-white/8 rounded-tl-sm'
                                                }`}>
                                                {renderContent(msg.content)}
                                            </div>
                                            {msg.role === 'user' && !isLoading && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleEditStart(i, msg.content)}
                                                    className="absolute -left-6 top-1 opacity-0 group-hover:opacity-100 transition-opacity text-ink/30 hover:text-ink/60 text-xs"
                                                >
                                                    ✎
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex justify-start items-center gap-2">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                                    style={{ backgroundColor: '#C8955A' }}>
                                    R
                                </div>
                                <div className="bg-ink/5 dark:bg-white/8 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3">
                                    <div className="flex gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: '#C8955A', animationDelay: '0ms' }} />
                                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: '#C8955A', animationDelay: '150ms' }} />
                                        <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: '#C8955A', animationDelay: '300ms' }} />
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
                                    if (e.key === 'Enter' && !isLoading) handleSend()
                                }}
                                placeholder={zh ? '問 Ronnie...' : 'Ask Ronnie...'}
                                className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent"
                            />
                            <button type="button" onClick={() => handleSend()}
                                disabled={!input.trim() || isLoading}
                                className="rounded-xl px-3 py-2 text-sm font-medium text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: '#C8955A' }}>
                                {zh ? '發送' : 'Send'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}