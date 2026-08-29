'use client'

import { useState, useRef, useEffect } from 'react'

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
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const bottomRef = useRef<HTMLDivElement>(null)

    const todayKey = `${STORAGE_KEY_PREFIX}${userId}_${new Date().toISOString().split('T')[0]}`

    // 載入今天的對話
    useEffect(() => {
        try {
            const saved = localStorage.getItem(todayKey)
            if (saved) {
                setMessages(JSON.parse(saved))
            }
        } catch { /* ignore */ }
    }, [todayKey])

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
    }, [messages, isOpen])

    async function handleSend(text?: string) {
        const content = text ?? input.trim()
        if (!content || isLoading) return

        const userMsg: Message = { role: 'user', content }
        const newMessages = [...messages, userMsg]
        setMessages(newMessages)
        setInput('')
        setIsLoading(true)

        try {
            const res = await fetch('/api/ai/coach', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
                    language,
                }),
            })
            const data = await res.json()
            setMessages((prev) => [...prev, { role: 'assistant', content: data.message }])
        } catch {
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: zh ? '發生錯誤，請再試一次。' : 'Something went wrong. Please try again.',
            }])
        } finally {
            setIsLoading(false)
        }
    }

    function handleClear() {
        setMessages([])
        localStorage.removeItem(todayKey)
    }

    return (
        <>
            {/* 懸浮按鈕 */}
            {!isOpen && (
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-24 right-4 sm:bottom-8 sm:right-8 z-40 w-14 h-14 rounded-full bg-plate dark:bg-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
                    aria-label="Open Ronnie"
                >
                    <span className="text-chalk dark:text-[#1A1814] font-bold text-lg">R</span>
                </button>
            )}

            {/* Chat Widget */}
            {isOpen && (
                <div className="fixed bottom-24 right-4 sm:bottom-8 sm:right-8 z-50 w-[340px] sm:w-[380px] h-[520px] rounded-2xl bg-white dark:bg-[#2C2923] shadow-2xl flex flex-col overflow-hidden border border-ink/10 dark:border-white/10">

                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 bg-plate dark:bg-[#1E1C19] shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[#C8955A] flex items-center justify-center font-bold text-white text-sm">
                                R
                            </div>
                            <div>
                                <p className="font-semibold text-sm text-white">Ronnie</p>
                                <p className="text-xs text-white/50">
                                    {zh ? 'AI 隨身教練' : 'AI Personal Coach'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {messages.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleClear}
                                    className="text-xs text-white/40 hover:text-white/70 transition-colors"
                                >
                                    {zh ? '清除' : 'Clear'}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="text-white/50 hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {messages.length === 0 && (
                            <div className="text-center space-y-3 pt-4">
                                <div className="text-4xl">💪</div>
                                <p className="text-sm font-medium">
                                    {zh ? 'Ain\'t nothin\' but a peanut!' : 'Ain\'t nothin\' but a peanut!'}
                                </p>
                                <p className="text-xs text-ink/40 dark:text-white/40">
                                    {zh
                                        ? '問我任何健身問題，或讓我幫你調整今天的課表'
                                        : 'Ask me anything about training, or let me help adjust today\'s workout'}
                                </p>
                                {/* 快捷問題 */}
                                <div className="space-y-2 pt-2">
                                    {(zh ? [
                                        '今天我做了什麼？',
                                        '深蹲有什麼替代動作？',
                                        '怎麼使用 GymPro？',
                                    ] : [
                                        "What did I do today?",
                                        "What are squat alternatives?",
                                        "How do I use GymPro?",
                                    ]).map((q) => (
                                        <button
                                            key={q}
                                            type="button"
                                            onClick={() => handleSend(q)}
                                            className="block w-full text-left rounded-xl border border-ink/10 dark:border-white/10 px-3 py-2 text-xs hover:bg-ink/5 dark:hover:bg-white/5 transition-colors"
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {msg.role === 'assistant' && (
                                    <div className="w-6 h-6 rounded-full bg-[#C8955A] flex items-center justify-center text-white font-bold text-xs mr-2 mt-1 shrink-0">
                                        R
                                    </div>
                                )}
                                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${msg.role === 'user'
                                    ? 'bg-plate dark:bg-white text-chalk dark:text-[#1A1814] rounded-tr-sm'
                                    : 'bg-ink/5 dark:bg-white/8 rounded-tl-sm'
                                    }`}>
                                    {msg.content.split('\n').map((line, i) => (
                                        <span key={i}>
                                            {line}
                                            {i < msg.content.split('\n').length - 1 && <br />}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="w-6 h-6 rounded-full bg-[#C8955A] flex items-center justify-center text-white font-bold text-xs mr-2 shrink-0">
                                    R
                                </div>
                                <div className="bg-ink/5 dark:bg-white/8 rounded-2xl rounded-tl-sm px-4 py-3">
                                    <div className="flex gap-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#C8955A] animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#C8955A] animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#C8955A] animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 border-t border-ink/10 dark:border-white/10 shrink-0">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                                placeholder={zh ? '問 Ronnie...' : 'Ask Ronnie...'}
                                disabled={isLoading}
                                className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent disabled:opacity-50"
                            />
                            <button
                                type="button"
                                onClick={() => handleSend()}
                                disabled={!input.trim() || isLoading}
                                className="rounded-xl bg-plate dark:bg-white px-3 py-2 text-sm font-medium text-chalk dark:text-[#1A1814] disabled:opacity-50 hover:opacity-90 transition-opacity"
                            >
                                {zh ? '送' : 'Send'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}