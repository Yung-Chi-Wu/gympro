'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface ChatResponse {
    action: 'ask' | 'generate_routine'
    message: string
    options?: string[]
    routines?: GeneratedRoutine[]
}

interface GeneratedExercise {
    exercise_name: string
    exercise_name_zh_tw?: string
    muscle_group: string
    target_sets: number
    target_reps: number
}

interface GeneratedRoutine {
    name: string
    name_zh_tw?: string
    exercises: GeneratedExercise[]
}

interface CoachGChatProps {
    language: string
    trainingGoal: string | null
    onRoutinesGenerated: (routines: GeneratedRoutine[]) => void
    onClose: () => void
}

export function CoachGChat({ language, trainingGoal, onRoutinesGenerated, onClose }: CoachGChatProps) {
    const zh = language === 'zh-TW'
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [options, setOptions] = useState<string[]>([])
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // 開場白
        startChat()
    }, [])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    async function startChat() {
        setIsLoading(true)
        const greeting: Message = {
            role: 'user',
            content: zh
                ? '你好！請幫我設計一份訓練課表。'
                : 'Hi! Please help me design a training routine.',
        }
        await sendMessage([greeting])
    }

    async function sendMessage(msgs: Message[]) {
        setIsLoading(true)
        setOptions([])

        try {
            const res = await fetch('/api/ai/routine-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: msgs,
                    language,
                    trainingGoal,
                }),
            })

            const data: ChatResponse = await res.json()

            const assistantMsg: Message = {
                role: 'assistant',
                content: data.message,
            }

            setMessages([...msgs, assistantMsg])

            if (data.action === 'ask') {
                setOptions(data.options ?? [])
            } else if (data.action === 'generate_routine' && data.routines) {
                onRoutinesGenerated(data.routines)
            }
        } catch {
            const errMsg: Message = {
                role: 'assistant',
                content: zh ? '發生錯誤，請再試一次。' : 'Something went wrong. Please try again.',
            }
            setMessages((prev) => [...prev, errMsg])
        } finally {
            setIsLoading(false)
        }
    }

    async function handleSend(text?: string) {
        const content = text ?? input.trim()
        if (!content || isLoading) return

        const userMsg: Message = { role: 'user', content }
        const newMessages = [...messages, userMsg]
        setMessages(newMessages)
        setInput('')

        await sendMessage(newMessages)
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-ink/10">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-sm">
                        G
                    </div>
                    <div>
                        <p className="font-semibold text-sm">Coach G</p>
                        <p className="text-xs text-ink/40">
                            {zh ? 'AI 課表設計師' : 'AI Routine Designer'}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-ink/40 hover:text-ink transition-colors"
                >
                    ✕
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                            <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 mt-1 shrink-0">
                                G
                            </div>
                        )}
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'user'
                                ? 'bg-plate dark:bg-white text-chalk dark:text-[#1A1814] rounded-tr-sm'
                                : 'bg-ink/5 dark:bg-white/8 rounded-tl-sm'
                            }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="flex justify-start">
                        <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 shrink-0">
                            G
                        </div>
                        <div className="bg-ink/5 dark:bg-white/8 rounded-2xl rounded-tl-sm px-4 py-3">
                            <div className="flex gap-1">
                                <div className="w-2 h-2 rounded-full bg-ink/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-2 h-2 rounded-full bg-ink/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-2 h-2 rounded-full bg-ink/30 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* Options */}
            {options.length > 0 && !isLoading && (
                <div className="px-4 pb-2 flex flex-wrap gap-2">
                    {options.map((opt, i) => (
                        <button
                            key={i}
                            type="button"
                            onClick={() => handleSend(opt)}
                            className="rounded-full border border-ink/20 dark:border-white/20 px-3 py-1.5 text-xs font-medium hover:bg-plate hover:text-chalk dark:hover:bg-white dark:hover:text-[#1A1814] hover:border-plate dark:hover:border-white transition-colors"
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}

            {/* Input */}
            <div className="p-4 border-t border-ink/10">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder={zh ? '或直接輸入你的情況...' : 'Or type your situation...'}
                        disabled={isLoading}
                        className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent disabled:opacity-50"
                    />
                    <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        className="rounded-xl bg-plate dark:bg-white px-4 py-2 text-sm font-medium text-chalk dark:text-[#1A1814] disabled:opacity-50 hover:opacity-90 transition-opacity"
                    >
                        {zh ? '送出' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    )
}