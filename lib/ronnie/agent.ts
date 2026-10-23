import type Anthropic from '@anthropic-ai/sdk'
import { stripMarkdown } from './prompt'
import { RONNIE_TOOLS } from './tools'
import type { RonnieExecutor } from './executor'
import { doneClaimCorrection, doneClaimFeedback, doneClaims } from './reply-check'
import { renumber, withSources, type ReplySource } from './citations'
import { checkKnowledge, overclaimFeedback, RESEARCH_WORDS, type KnowledgeVerdict } from './knowledge-check'
import { medicineNote, mentionsMedicine, refersToDoctor } from './medicine-check'

// Ronnie's agent loop. The caller passes the full history - tool calls and results
// included - and stores the `messages` returned, so an ID looked up stays available.

// Chosen by the eval (2026-10-07): 88% on the knowledge set to Haiku 4.5's 48%, 39 of 40
// side-by-side wins, no wrong changes. With prompt caching about 1.5x Haiku's cost.
export const RONNIE_MODEL = 'claude-sonnet-5-5'

const MAX_TOOL_ROUNDS = 5
// Before the last two user turns, tool results longer than this are sent as a placeholder
// (the stored history keeps them); short ones such as search hits with IDs stay.
const KEEP_RECENT_USER_TURNS = 2
const COMPACT_OVER_CHARS = 400

export interface RonnieToolCall {
    name: string
    input: Record<string, string>
    result: string
}

export interface RonnieTurn {
    message: string
    reloadDashboard: boolean
    /**
     * Set when the turn stopped early, after a tool had already changed or shown something: the
     * model call failed ('error') or the user pressed Stop ('aborted'). The message then says what
     * was done, so the change isn't lost from the conversation.
     */
    interrupted?: { reason: 'error' | 'aborted'; error: string }
    /** The full history after this turn, to store and send back next time. */
    messages: Anthropic.MessageParam[]
    // For the eval: every tool call made this turn, and what each API call used
    toolCalls: RonnieToolCall[]
    usage: Anthropic.Usage[]
    servedModel: string | null
    /** The reply check fired: what the first draft claimed, the draft itself, and whether the retry fixed it */
    replyCheck?: { claimed: string[]; fixed: boolean; draft: string }
    /** The papers the reply cites, numbered as its sentences are ([1], [2]): written by code (citations.ts) */
    sources?: ReplySource[]
    /** The reply gives general fitness advice no note supports: the chat says so under it (knowledge-check.ts) */
    unsourced?: boolean
    /**
     * The knowledge check ran: its verdict on the first draft, the draft when it was sent back, the
     * verdict after, keys the reply used that no note had, and the check's own usage (Haiku)
     */
    knowledgeCheck?: { first: KnowledgeVerdict; retried: boolean; draft?: string; after?: KnowledgeVerdict; unknownKeys?: string[]; usage: Anthropic.Usage[] }
    /** The reply is about a medicine and sends them to no doctor or pharmacist: code added the line under it (medicine-check.ts) */
    medicineNoted?: boolean
}

const isUserText = (m: Anthropic.MessageParam) =>
    m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'))

/** Shrink bulky tool results from earlier turns; the latest turns are sent in full. */
export function compactHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    const userTurns = messages.map((m, i) => (isUserText(m) ? i : -1)).filter((i) => i >= 0)
    const keepFrom = userTurns.length > KEEP_RECENT_USER_TURNS ? userTurns[userTurns.length - KEEP_RECENT_USER_TURNS] : 0
    return messages.map((m, i) => {
        if (i >= keepFrom || m.role !== 'user' || typeof m.content === 'string') return m
        return {
            ...m,
            content: m.content.map((b) =>
                b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > COMPACT_OVER_CHARS
                    ? { ...b, content: `[Earlier tool result omitted (${b.content.length} characters) - call the tool again if you need it]` }
                    : b
            ),
        }
    })
}

// Sonnet 5.5 thinks by default; low effort skips it on most simple turns. Its thinking blocks are
// bound to the exact history before them, which compactHistory changes, so a mismatched block is
// dropped rather than failing the request. Thinking counts toward max_tokens.
function modelOptions(model: string): { params: Partial<Anthropic.MessageCreateParamsNonStreaming>; headers?: Record<string, string> } {
    if (!model.startsWith('claude-sonnet-5-5')) return { params: {} }
    return {
        params: {
            max_tokens: 4096,
            output_config: { effort: 'low' },
            // block_binding is not in the SDK types yet
            thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } } as unknown as Anthropic.ThinkingConfigParam,
        },
        headers: { 'anthropic-beta': 'thinking-binding-controls-2026-08-01' },
    }
}

const textOf = (content: Anthropic.ContentBlock[]) =>
    content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')

export async function runRonnieTurn({
    client,
    system,
    messages,
    executor,
    language,
    model = RONNIE_MODEL,
    signal,
    tools = RONNIE_TOOLS,
}: {
    client: Anthropic
    system: string
    messages: Anthropic.MessageParam[]
    executor: RonnieExecutor
    language: string
    model?: string
    /** Aborted when the user presses Stop: the in-flight call is cancelled and no more tools run */
    signal?: AbortSignal
    /** Ronnie's tools; the eval leaves one out to measure without it (the knowledge baseline) */
    tools?: Anthropic.Tool[]
}): Promise<RonnieTurn> {
    const toolCalls: RonnieToolCall[] = []
    const usage: Anthropic.Usage[] = []
    let servedModel: string | null = null
    const history = [...messages]
    const options = modelOptions(model)
    const zh = language === 'zh-TW'
    const sorry = zh ? '抱歉，請再問一次。' : 'Sorry, please try again.'

    // A plan card is said in the code's words, under the reply: whether it is saved must be stated
    // exactly, and given the tool's wording the model still opened "✅ 課表排好了" (eval v29)
    const planLine = () => (executor.plans.length
        ? (zh ? '📋 課表在下面的卡片上：可以先修改，按「存入」後才會取代你目前的課表和訓練循環。' : '📋 The plan is on the card below: you can edit it first, and it replaces your current routines and training cycle only when you tap Save.')
        : '')

    // The reply, checked against today's log before it's shown (reply-check.ts). A claim the log
    // contradicts goes back to the model once, without tools; if it stays, or the retry fails, the
    // reply is shown with a correction in the code's words under it
    let replyCheck: RonnieTurn['replyCheck']
    let correction = ''
    const checked = async (content: Anthropic.ContentBlock[]): Promise<Anthropic.ContentBlock[]> => {
        // A turn with a proposal answers in the code's words, which claim nothing about the log
        const text = textOf(content)
        if (executor.proposals.length || !text.trim()) return content
        // A log that can't be read checks nothing: the reply goes as it is
        const today = await executor.todayLog().catch(() => [])
        const claimed = doneClaims(text, today)
        if (!claimed.length) return content
        replyCheck = { claimed, fixed: false, draft: text }
        try {
            const retry = await client.messages.create({
                model,
                max_tokens: 1024,
                system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
                tools,
                tool_choice: { type: 'none' },
                // The reply and the check aren't kept in the history: only the reply shown is
                messages: compactHistory([...history, { role: 'assistant', content: [{ type: 'text', text }] }, { role: 'user', content: doneClaimFeedback(claimed) }]),
                ...options.params,
            }, { signal, ...(options.headers ? { headers: options.headers } : {}) })
            usage.push(retry.usage)
            servedModel = retry.model
            const again = textOf(retry.content)
            if (again.trim()) {
                const still = doneClaims(again, today)
                replyCheck.fixed = still.length === 0
                if (still.length) correction = doneClaimCorrection(still, zh)
                return retry.content
            }
        } catch (err) {
            if (signal?.aborted) throw err
        }
        correction = doneClaimCorrection(claimed, zh)
        return content
    }

    // The reply's research claims, checked against the notes it was given (knowledge-check.ts):
    // a turn that searched the notes, or a reply that presents something as research. Claims the
    // notes don't support go back to the model once, without tools; general advice no note supports
    // stays, and is labelled under the reply
    let knowledgeCheck: RonnieTurn['knowledgeCheck']
    let unsourced = false
    const question = () => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]
            if (m.role !== 'user') continue
            if (typeof m.content === 'string') return m.content
            const text = m.content.filter((b): b is Anthropic.TextBlockParam => b.type === 'text').map((b) => b.text).join('')
            if (text) return text
        }
        return ''
    }
    const sourced = async (content: Anthropic.ContentBlock[]): Promise<Anthropic.ContentBlock[]> => {
        const text = textOf(content)
        if (executor.proposals.length || !text.trim()) return content
        if (!executor.knowledge.length && !RESEARCH_WORDS.test(text)) return content
        const first = await checkKnowledge(client, { question: question(), reply: text, notes: executor.knowledge, signal })
        knowledgeCheck = { first: first.verdict, retried: false, usage: first.usage ? [first.usage] : [] }
        let final = first.verdict
        let out = content
        if (first.verdict.overclaims.length) {
            knowledgeCheck.retried = true
            knowledgeCheck.draft = text
            try {
                const retry = await client.messages.create({
                    model,
                    max_tokens: 1024,
                    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
                    tools,
                    tool_choice: { type: 'none' },
                    messages: compactHistory([...history, { role: 'assistant', content: [{ type: 'text', text }] }, { role: 'user', content: overclaimFeedback(first.verdict.overclaims) }]),
                    ...options.params,
                }, { signal, ...(options.headers ? { headers: options.headers } : {}) })
                usage.push(retry.usage)
                servedModel = retry.model
                const again = textOf(retry.content)
                if (again.trim()) {
                    const second = await checkKnowledge(client, { question: question(), reply: again, notes: executor.knowledge, signal })
                    if (second.usage) knowledgeCheck.usage.push(second.usage)
                    knowledgeCheck.after = second.verdict
                    final = second.verdict
                    out = retry.content
                }
            } catch (err) {
                if (signal?.aborted) throw err
            }
        }
        unsourced = final.general
        return out
    }

    const finish = (content: Anthropic.ContentBlock[]): RonnieTurn => {
        // A turn that proposed a routine change answers in the code's words: whether a change is
        // applied must be stated exactly, and given the wording the model still said "Done!". What
        // wasn't proposed is said too (a 4th removal, a routine name that matched two), or the
        // user only saw the three that were.
        const proposed = executor.proposals.length > 0
        const codeLines = [...executor.confirmations, ...executor.notices].join('\n')
        // An empty reply falls back to what the tools changed. Its citations become numbers, with the
        // papers listed under it by code; a key no note had this turn is dropped
        const cited = withSources(proposed ? '' : stripMarkdown(textOf(content)), executor.knowledge)
        if (cited.unknown.length) knowledgeCheck = { ...(knowledgeCheck ?? { first: { overclaims: [], general: false }, retried: false, usage: [] }), unknownKeys: cited.unknown }
        // A turn that searched the notes and cites none answers as general coaching, so it is labelled
        // whatever the check says: given replies that called themselves "my own coaching advice", the
        // check left all 6 such runs unlabelled (eval v30)
        const searched = toolCalls.some((c) => c.name === 'search_knowledge')
        const general = unsourced || (searched && !cited.sources.length && !!cited.text.trim())
        const answer = proposed ? codeLines : cited.text || codeLines
        // A reply about a medicine leaves the decision to a doctor or pharmacist, in the code's words
        // when it names neither (medicine-check.ts)
        const medicineLine = !proposed && answer && (mentionsMedicine(question()) || mentionsMedicine(answer)) && !refersToDoctor(answer) ? medicineNote(zh) : ''
        // A note saved or forgotten is said in the code's words, first, as something done: the model
        // claimed to have remembered things it never saved (the memory baseline, 5 of 42 runs)
        const memoryLines = executor.remembered.join('\n')
        const text = [memoryLines, answer || (memoryLines || planLine() ? '' : sorry), correction, medicineLine, planLine()].filter(Boolean).join('\n\n')
        // A reply cut off by max_tokens can end in a half-written tool call, which stored
        // without its result would make the next request invalid
        const kept = proposed ? [] : [
            // Stored with the numbers shown, so a later turn's keys never read as these
            ...content.filter((b) => b.type !== 'tool_use').map((b) => (b.type === 'text' ? { ...b, text: renumber(b.text, cited.numbers) } : b)),
            // The correction is part of what was said, so the next turn doesn't take the claim as standing
            ...(correction ? [{ type: 'text' as const, text: correction, citations: null }] : []),
            ...(medicineLine ? [{ type: 'text' as const, text: medicineLine, citations: null }] : []),
        ]
        return {
            message: text,
            reloadDashboard: executor.needsDashboardReload,
            messages: [...history, { role: 'assistant', content: kept.length ? kept : [{ type: 'text', text }] }],
            toolCalls,
            usage,
            servedModel,
            ...(replyCheck ? { replyCheck } : {}),
            ...(cited.sources.length && !proposed ? { sources: cited.sources } : {}),
            ...(general && !proposed ? { unsourced: true } : {}),
            ...(knowledgeCheck ? { knowledgeCheck } : {}),
            ...(medicineLine ? { medicineNoted: true } : {}),
        }
    }

    // Something the user can see already happened: a change to today's workout, a proposal card, a
    // recommendation card, a plan card, a note saved. A turn that stops after that must still report it.
    const didSomething = () => executor.confirmations.length > 0 || executor.proposals.length > 0 || executor.recommendations.length > 0
        || executor.plans.length > 0 || executor.remembered.length > 0
    const interrupted = (reason: 'error' | 'aborted', err: unknown): RonnieTurn => {
        const stopped = reason === 'aborted'
            ? (zh ? '（已停止，上面是停止前已經完成的。）' : '(Stopped. Above is what was done before you stopped.)')
            : (zh ? '（回覆沒有完成，上面是已經完成的部分，請再問一次。）' : "(The reply didn't finish. Above is what was already done; please ask again.)")
        const text = [...executor.remembered, ...executor.confirmations, ...executor.notices, ...(planLine() ? [planLine()] : []), stopped].join('\n')
        return {
            message: text,
            reloadDashboard: executor.needsDashboardReload,
            // The history ends with the user's message or the last tool results, so a text reply keeps it valid
            messages: [...history, { role: 'assistant', content: [{ type: 'text', text }] }],
            toolCalls,
            usage,
            servedModel,
            interrupted: { reason, error: err instanceof Error ? err.message : String(err) },
        }
    }

    // A failed call still reports what the turn used and did, for its trace
    try {
        // The model now and then ends a turn with no text; one fresh sample usually answers
        let emptyRetried = false
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            if (signal?.aborted) {
                if (didSomething()) return interrupted('aborted', signal.reason)
                throw signal.reason instanceof Error ? signal.reason : new Error('Aborted')
            }
            // Out of tool rounds: one last call without tools, so the work done is summarised, not lost
            const lastRound = round === MAX_TOOL_ROUNDS
            const response = await client.messages.create({
                model,
                max_tokens: 1024,
                // The system prompt and tools are the same all day; the automatic breakpoint lets each
                // tool round reuse the conversation so far. Below the model's minimum it isn't cached.
                system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
                cache_control: { type: 'ephemeral' },
                tools,
                ...(lastRound ? { tool_choice: { type: 'none' as const } } : {}),
                messages: compactHistory(history),
                ...options.params,
            }, { signal, ...(options.headers ? { headers: options.headers } : {}) })
            usage.push(response.usage)
            servedModel = response.model

            if (response.stop_reason !== 'tool_use') {
                if (!textOf(response.content).trim() && !lastRound && !emptyRetried) {
                    emptyRetried = true
                    continue
                }
                return finish(await sourced(await checked(response.content)))
            }

            // A tool that throws (a database error, a malformed date) answers as a failed result, so the
            // turn goes on: thrown, it rejected the whole Promise.all and discarded the turn, though a
            // tool running beside it had already changed today's workout
            const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
                response.content
                    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
                    .map(async (tb) => {
                        const input = tb.input as Record<string, string>
                        try {
                            const result = await executor.executeTool(tb.name, input)
                            toolCalls.push({ name: tb.name, input, result })
                            return { type: 'tool_result' as const, tool_use_id: tb.id, content: result }
                        } catch (err) {
                            const result = `${tb.name} failed: ${err instanceof Error ? err.message : String(err)}. Nothing was confirmed by this call; tell the user it didn't go through.`
                            toolCalls.push({ name: tb.name, input, result })
                            return { type: 'tool_result' as const, tool_use_id: tb.id, content: result, is_error: true }
                        }
                    })
            )
            history.push({ role: 'assistant', content: response.content }, { role: 'user', content: toolResults })
        }

        // Unreachable: the last round runs with tool_choice none
        return finish([])
    } catch (err) {
        // After a change, the turn ends with what was done instead of an error that hides it
        if (didSomething()) return interrupted(signal?.aborted ? 'aborted' : 'error', err)
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { usage, toolCalls, servedModel })
    }
}
