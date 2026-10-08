import type Anthropic from '@anthropic-ai/sdk'
import { stripMarkdown } from './prompt'
import { RONNIE_TOOLS } from './tools'
import type { RonnieExecutor } from './executor'

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
    /** The full history after this turn, to store and send back next time. */
    messages: Anthropic.MessageParam[]
    // For the eval: every tool call made this turn, and what each API call used
    toolCalls: RonnieToolCall[]
    usage: Anthropic.Usage[]
    servedModel: string | null
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
}: {
    client: Anthropic
    system: string
    messages: Anthropic.MessageParam[]
    executor: RonnieExecutor
    language: string
    model?: string
}): Promise<RonnieTurn> {
    const toolCalls: RonnieToolCall[] = []
    const usage: Anthropic.Usage[] = []
    let servedModel: string | null = null
    const history = [...messages]
    const options = modelOptions(model)
    const sorry = language === 'zh-TW' ? '抱歉，請再問一次。' : 'Sorry, please try again.'

    const finish = (content: Anthropic.ContentBlock[]): RonnieTurn => {
        // A turn that proposed a routine change answers in the code's words: whether a change is
        // applied must be stated exactly, and given the wording the model still said "Done!"
        const proposed = executor.proposals.length > 0
        // An empty reply falls back to what the tools changed
        const text = proposed ? executor.confirmations.join('\n') : stripMarkdown(textOf(content)) || executor.confirmations.join('\n') || sorry
        // A reply cut off by max_tokens can end in a half-written tool call, which stored
        // without its result would make the next request invalid
        const kept = proposed ? [] : content.filter((b) => b.type !== 'tool_use')
        return {
            message: text,
            reloadDashboard: executor.needsDashboardReload,
            messages: [...history, { role: 'assistant', content: kept.length ? kept : [{ type: 'text', text }] }],
            toolCalls,
            usage,
            servedModel,
        }
    }

    // The model now and then ends a turn with no text; one fresh sample usually answers
    let emptyRetried = false
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // Out of tool rounds: one last call without tools, so the work done is summarised, not lost
        const lastRound = round === MAX_TOOL_ROUNDS
        const response = await client.messages.create({
            model,
            max_tokens: 1024,
            // The system prompt and tools are the same all day; the automatic breakpoint lets each
            // tool round reuse the conversation so far. Below the model's minimum it isn't cached.
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            cache_control: { type: 'ephemeral' },
            tools: RONNIE_TOOLS,
            ...(lastRound ? { tool_choice: { type: 'none' as const } } : {}),
            messages: compactHistory(history),
            ...options.params,
        }, options.headers ? { headers: options.headers } : undefined)
        usage.push(response.usage)
        servedModel = response.model

        if (response.stop_reason !== 'tool_use') {
            if (!textOf(response.content).trim() && !lastRound && !emptyRetried) {
                emptyRetried = true
                continue
            }
            return finish(response.content)
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            response.content
                .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
                .map(async (tb) => {
                    const input = tb.input as Record<string, string>
                    const result = await executor.executeTool(tb.name, input)
                    toolCalls.push({ name: tb.name, input, result })
                    return { type: 'tool_result' as const, tool_use_id: tb.id, content: result }
                })
        )
        history.push({ role: 'assistant', content: response.content }, { role: 'user', content: toolResults })
    }

    // Unreachable: the last round runs with tool_choice none
    return finish([])
}
