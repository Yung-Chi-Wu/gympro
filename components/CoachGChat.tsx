'use client'

import { useState, useRef, useEffect } from 'react'
import { isSubmitEnter } from '@/lib/keyboard'
import { MAX_ANSWER_CHARS } from '@/lib/coach-g'
import { reportClientError, responseError } from '@/lib/report-client-error'

interface Message {
    role: 'user' | 'assistant'
    content: string
}

interface ChatResponse {
    action: 'ask' | 'ready_to_generate'
    message: string
    question?: string
    options?: string[]
    multi_select?: boolean
    skippable?: boolean
    nextStep?: number
    collected?: Record<string, string | string[] | null>
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
    /** goals: the goal answers, which the result offers to save as the user's goal */
    onRoutinesGenerated: (routines: GeneratedRoutine[], cycleLength: number, goals: string[]) => void
    onClose: () => void
}

export function CoachGChat({ language, onRoutinesGenerated, onClose }: CoachGChatProps) {
    const zh = language === 'zh-TW'
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    // The first question loads as soon as the chat opens
    const [isLoading, setIsLoading] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [options, setOptions] = useState<string[]>([])
    const [selectedOptions, setSelectedOptions] = useState<string[]>([])
    const [isMultiSelect, setIsMultiSelect] = useState(false)
    const [isSkippable, setIsSkippable] = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const [collected, setCollected] = useState<Record<string, string | string[] | null>>({})
    // The answers of a plan that didn't come back, for Try again
    const [failedAnswers, setFailedAnswers] = useState<Record<string, string | string[] | null> | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)

    const STEP_KEYS = ['', 'days', 'duration', 'equipment', 'goals', 'level', 'injuries', 'notes']

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, options, isGenerating])

    /** Clears the last question's choices before the next request; its answer fills them again */
    function startRequest() {
        setIsLoading(true)
        setOptions([])
        setSelectedOptions([])
        setIsMultiSelect(false)
        setIsSkippable(false)
    }

    /** One step of the chat from the API: the next question, or the answers to build routines from */
    async function fetchStep(step: number, userAnswer: string | null, updatedCollected: Record<string, string | string[] | null>): Promise<ChatResponse> {
        const res = await fetch('/api/ai/routine-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentStep: step,
                userAnswer,
                language,
                collected: updatedCollected,
            }),
        })
        return res.json()
    }

    /** Shows a step: the next question with its choices, or builds the routines */
    async function applyStep(data: ChatResponse) {
        // 顯示 AI 的回應訊息
        if (data.message) {
            setMessages((prev) => [...prev, { role: 'assistant', content: data.message }])
        }

        if (data.action === 'ask' && data.question) {
            // 問題也加進 messages，這樣回答後不會消失
            setMessages((prev) => [...prev, { role: 'assistant', content: data.question! }])
            setOptions(data.options ?? [])
            setIsMultiSelect(data.multi_select ?? false)
            setIsSkippable(data.skippable ?? false)
            if (data.nextStep) setCurrentStep(data.nextStep)
        } else if (data.action === 'ready_to_generate' && data.collected) {
            await generate(data.collected)
        }
    }

    /** Builds the plan from the answers; when none comes back, says so and offers to try again */
    async function generate(answers: Record<string, string | string[] | null>) {
        setIsLoading(false)
        setFailedAnswers(null)
        setIsGenerating(true)
        try {
            const genRes = await fetch('/api/ai/generate-routine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collected: answers, language }),
            })
            const genData = await genRes.json().catch(() => null)
            if (genData?.action === 'generate_routine' && genData.routines?.length) {
                const goals = Array.isArray(answers.goals) ? answers.goals : answers.goals ? [answers.goals] : []
                onRoutinesGenerated(genData.routines, genData.cycle_length ?? genData.routines.length, goals)
                return
            }
            reportClientError('client/coach-g/generate', responseError(`Generate request failed: ${genRes.status}`, genRes.status, genData))
        } catch (err) {
            // Said to the user below
            reportClientError('client/coach-g/generate', err)
        } finally {
            setIsGenerating(false)
        }
        setMessages((prev) => [...prev, {
            role: 'assistant',
            content: zh ? '這次沒排出課表，請再試一次。' : "I couldn't put the plan together this time. Please try again.",
        }])
        setFailedAnswers(answers)
    }

    function showError() {
        setMessages((prev) => [...prev, {
            role: 'assistant',
            content: zh ? '發生錯誤，請再試一次。' : 'Something went wrong. Please try again.',
        }])
    }

    // The first question, once the chat opens. State changes only when the answer arrives,
    // and there is nothing to clear yet (isLoading starts true)
    useEffect(() => {
        fetchStep(0, null, {}).then(applyStep).catch((err) => {
            reportClientError('client/coach-g/step', err)
            showError()
        }).finally(() => setIsLoading(false))
    }, [])

    async function handleAnswer(answer: string) {
        if (!answer.trim() || isLoading || isGenerating) return

        // 顯示使用者訊息
        setMessages((prev) => [...prev, { role: 'user', content: answer }])
        setInput('')
        setOptions([])
        setSelectedOptions([])

        // 更新收集到的答案
        const key = STEP_KEYS[currentStep]
        const updatedCollected = { ...collected }
        if (key) {
            if (isMultiSelect) {
                updatedCollected[key] = answer.split(', ')
            } else if (answer === (zh ? '跳過' : 'Skip')) {
                updatedCollected[key] = null
            } else {
                updatedCollected[key] = answer
            }
        }
        setCollected(updatedCollected)

        // 呼叫下一步
        startRequest()
        try {
            await applyStep(await fetchStep(currentStep, answer, updatedCollected))
        } catch (err) {
            reportClientError('client/coach-g/step', err)
            showError()
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-ink/10">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-sm">G</div>
                    <div>
                        <p className="font-semibold text-sm">Coach G</p>
                        <p className="text-xs text-ink/40">{zh ? 'AI 課表設計師' : 'AI Routine Designer'}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        // Answers given so far aren't kept, so closing after the first one asks first
                        if (Object.keys(collected).length > 0 && !confirm(zh ? '要關閉 Coach G 嗎？已經回答的內容不會保留。' : "Close Coach G? Your answers so far won't be kept.")) return
                        onClose()
                    }}
                    aria-label={zh ? '關閉 Coach G' : 'Close Coach G'}
                    className="-m-3 p-3 text-ink/40 hover:text-ink transition-colors text-lg"
                >
                    ✕
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                            <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 mt-1 shrink-0">G</div>
                        )}
                        <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'user'
                            ? 'bg-plate dark:bg-white text-chalk dark:text-[#1A1814] rounded-tr-sm'
                            : 'bg-ink/5 dark:bg-white/8 rounded-tl-sm'
                            }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}



                {/* 生成中 */}
                {isGenerating && (
                    <div className="flex justify-start">
                        <div className="w-7 h-7 rounded-full bg-plate dark:bg-white flex items-center justify-center text-chalk dark:text-[#1A1814] font-bold text-xs mr-2 shrink-0">G</div>
                        <div className="bg-ink/5 dark:bg-white/8 rounded-xl rounded-tl-sm px-4 py-3 space-y-1">
                            <p className="text-sm font-medium">{zh ? '✨ 課表設計中...' : '✨ Designing your routine...'}</p>
                            <p className="text-xs text-ink/40">{zh ? '根據你的需求分析最適合的訓練計畫' : 'Analyzing the best plan for your goals'}</p>
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
                        <div className="bg-ink/5 dark:bg-white/8 rounded-xl rounded-tl-sm px-4 py-3">
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
            {(options.length > 0 || isSkippable) && !isLoading && !isGenerating && (
                <div className="px-4 pb-2 space-y-2">
                    {isMultiSelect && (
                        <p className="text-xs text-ink/40">
                            {zh ? '可以多選，選完按確認' : 'Select multiple, then confirm'}
                        </p>
                    )}
                    {options.length > 0 && (
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
                                                handleAnswer(opt)
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
                    )}
                    <div className="flex gap-2">
                        {isMultiSelect && selectedOptions.length > 0 && (
                            <button type="button"
                                onClick={() => handleAnswer(selectedOptions.join(', '))}
                                className="rounded-lg bg-plate dark:bg-white px-4 py-1.5 text-xs font-semibold text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity">
                                {zh ? `確認（${selectedOptions.length}）` : `Confirm (${selectedOptions.length})`}
                            </button>
                        )}
                        {isSkippable && (
                            <button type="button"
                                onClick={() => handleAnswer(zh ? '跳過' : 'Skip')}
                                className="rounded-lg border border-ink/20 dark:border-white/20 px-4 py-1.5 text-xs text-ink/50 dark:text-white/50 hover:text-ink dark:hover:text-white transition-colors">
                                {zh ? '跳過' : 'Skip'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {failedAnswers && !isGenerating && (
                <div className="px-4 pb-2">
                    <button type="button" onClick={() => generate(failedAnswers)}
                        className="rounded-lg bg-plate dark:bg-white px-4 py-1.5 text-xs font-semibold text-chalk dark:text-[#1A1814] hover:opacity-90 transition-opacity">
                        {zh ? '再試一次' : 'Try again'}
                    </button>
                </div>
            )}

            {/* Input */}
            <div className="p-4 border-t border-ink/10">
                <div className="flex gap-2">
                    <input type="text" value={input} maxLength={MAX_ANSWER_CHARS}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (isSubmitEnter(e) && input.trim()) handleAnswer(input.trim()) }}
                        placeholder={
                            isGenerating
                                ? (zh ? '課表設計中...' : 'Designing routine...')
                                : (zh ? '或直接打字回答...' : 'Or type your answer...')
                        }
                        disabled={isLoading || isGenerating}
                        className="flex-1 rounded-xl border border-ink/20 dark:border-white/20 px-3 py-2 text-sm bg-transparent disabled:opacity-50"
                    />
                    <button type="button"
                        onClick={() => { if (input.trim()) handleAnswer(input.trim()) }}
                        disabled={!input.trim() || isLoading || isGenerating}
                        className="rounded-xl bg-plate dark:bg-white px-4 py-2 text-sm font-medium text-chalk dark:text-[#1A1814] disabled:opacity-50 hover:opacity-90 transition-opacity">
                        {zh ? '送出' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    )
}