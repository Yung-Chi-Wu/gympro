'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface ChatResponse {
    action: 'ask' | 'ready_to_generate' | 'generate_routine'
    message: string
    options?: string[]
    multi_select?: boolean
    routines?: GeneratedRoutine[]
    cycle_length?: number
    collected?: {
        days: string
        duration: string
        equipment: string[]
        goals: string[]
        level: string
        injuries: string | null
        focus: string | null
    }
}

interface GeneratedRoutine {
    name: string
    name_zh_tw?: string
    day_indices: number[]
    exercises: {
        exercise_id: string
        exercise_name: string
        exercise_name_zh_tw?: string
        muscle_group: string
        target_sets: number
        target_reps: number
    }[]
}

interface CoachGChatProps {
    language: string
    trainingGoal: string | null
    onRoutinesGenerated: (routines: GeneratedRoutine[], cycleLength: number) => void
    onClose: () => void
}

export function CoachGChat({ language, trainingGoal, onRoutinesGenerated, onClose }: CoachGChatProps) {
    const zh = language === 'zh-TW'
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [options, setOptions] = useState<string[]>([])
    const [selectedOptions, setSelectedOptions] = useState<string[]>([])
    const [isMultiSelect, setIsMultiSelect] = useState(false)
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => { startChat() }, [])
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, options, isGenerating])

    async function startChat() {
        const greeting: Message = {
            role: 'user',
            content: zh ? '你好！請幫我設計一份訓練課表。' : 'Hi! Please help me design a training routine.',
        }
        await sendMessage([greeting])
    }

    async function sendMessage(msgs: Message[]) {
        setIsLoading(true)
        setOptions([])
        setSelectedOptions([])
        setIsMultiSelect(false)


        try {
            const res = await fetch('/api/ai/routine-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: msgs, language, trainingGoal }),
            })

            const data: ChatResponse = await res.json()
            setIsGenerating(false)

            const assistantMsg: Message = { role: 'assistant', content: data.message }
            setMessages([...msgs, assistantMsg])

            if (data.action === 'ask') {
                setOptions(data.options ?? [])
                setIsMultiSelect(data.multi_select ?? false)
                setSelectedOptions([])
            } else if (data.action === 'ready_to_generate' && data.collected) {
                // 問答完成，呼叫生成 API
                setIsGenerating(true)
                try {
                    const genRes = await fetch('/api/ai/generate-routine', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            collected: data.collected,
                            language,
                            trainingGoal,
                        }),
                    })
                    const genData = await genRes.json()
                    if (genData.action === 'generate_routine' && genData.routines) {
                        onRoutinesGenerated(genData.routines, genData.cycle_length ?? genData.routines.length)
                    }
                } finally {
                    setIsGenerating(false)
                }
            }
        } catch {
            setIsGenerating(false)
            setMessages((prev) => [...prev, {
                role: 'assistant',
                content: zh ? '發生錯誤，請再試一次。' : 'Something went wrong. Please try again.',
            }])
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
        setOptions([])
        setSelectedOptions([])

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
                <button type="button" onClick={onClose}
                    className="text-ink/40 hover:text-ink transition-colors text-lg">✕</button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                            <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 mt-1 shrink-0">G</div>
                        )}
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'user'
                            ? 'bg-plate dark:bg-white text-chalk dark:text-[#1A1814] rounded-tr-sm'
                            : 'bg-ink/5 dark:bg-white/8 rounded-tl-sm'
                            }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {/* 生成中的特殊 loading */}
                {isGenerating && (
                    <div className="flex justify-start">
                        <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 shrink-0">G</div>
                        <div className="bg-ink/5 dark:bg-white/8 rounded-2xl rounded-tl-sm px-4 py-3 space-y-1">
                            <p className="text-sm font-medium">
                                {zh ? '✨ 課表設計中...' : '✨ Designing your routine...'}
                            </p>
                            <p className="text-xs text-ink/40">
                                {zh ? '根據你的需求分析最適合的訓練計畫' : 'Analyzing the best plan for your goals'}
                            </p>
                            <div className="flex gap-1 mt-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#C8955A] animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-[#C8955A] animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-[#C8955A] animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* 一般 loading */}
                {isLoading && !isGenerating && (
                    <div className="flex justify-start">
                        <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 shrink-0">G</div>
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
                <div className="px-4 pb-2 space-y-2">
                    {isMultiSelect && (
                        <p className="text-xs text-ink/40">
                            {zh ? '可以多選，選完按確認' : 'Select multiple, then confirm'}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {options.map((opt, i) => {
                            const isSelected = selectedOptions.includes(opt)
                            return (
                                <button key={i} type="button"
                                    onClick={() => {
                                        if (isMultiSelect) {
                                            setSelectedOptions((prev) =>
                                                prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
                                            )
                                        } else {
                                            handleSend(opt)
                                        }
                                    }}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${isMultiSelect && isSelected
                                        ? 'bg-plate dark:bg-white border-plate dark:border-white text-chalk dark:text-[#1A1814]'
                                        : 'border-ink/20 dark:border-white/20 hover:border-ink/40 dark:hover:border-white/40'
                                        }`}>
                                    {isMultiSelect && isSelected ? '✓ ' : ''}{opt}
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex gap-2">
                        {isMultiSelect && selectedOptions.length > 0 && (
                            <button type="button"
                                onClick={() => { handleSend(selectedOptions.join('、')); setSelectedOptions([]) }}
                                className="rounded-lg bg-plate dark:bg-white px-4 py-1.5 text-xs font-semibold text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity">
                                {zh ? `確認（${selectedOptions.length}）` : `Confirm (${selectedOptions.length})`}
                            </button>
                        )}
                        <button type="button"
                            onClick={() => { handleSend(zh ? '沒有，跳過這題' : 'None, skip this question'); setSelectedOptions([]) }}
                            className="rounded-lg border border-ink/20 dark:border-white/20 px-4 py-1.5 text-xs text-ink/50 dark:text-white/50 hover:text-ink dark:hover:text-white transition-colors">
                            {zh ? '跳過 / 沒有' : 'Skip / None'}
                        </button>
                    </div>
                </div>
            )}

            {/* Input */}
            <div className="p-4 border-t border-ink/10">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                        placeholder={options.length > 0
                            ? (zh ? '也可以直接打字回答...' : 'Or type your answer...')
                            : (zh ? '輸入你的情況...' : 'Type your answer...')}
                        disabled={isLoading}
                        className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent disabled:opacity-50"
                    />
                    <button type="button" onClick={() => handleSend()}
                        disabled={!input.trim() || isLoading}
                        className="rounded-xl bg-plate dark:bg-white px-4 py-2 text-sm font-medium text-chalk dark:text-[#1A1814] disabled:opacity-50 hover:opacity-90 transition-opacity">
                        {zh ? '送出' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    )
}