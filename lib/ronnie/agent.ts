import type Anthropic from '@anthropic-ai/sdk'
import { stripMarkdown } from './prompt'
import { RONNIE_TOOLS } from './tools'
import type { RonnieExecutor } from './executor'

// Ronnie's agent loop. The caller passes the full history - tool calls and
// results included - and stores the `messages` returned, so an ID Ronnie looked
// up stays available in later turns.

export const RONNIE_MODEL = 'claude-haiku-4-5'

const MAX_TOOL_ROUNDS = 5
// Tool results longer than this, from before the last two user turns, are
// replaced by a placeholder when sent to the model (the stored history keeps
// them). Short results such as search hits and their IDs are kept as they are.
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
    // For the eval runner: every tool call made this turn, and what each API call used
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

    const finish = (content: Anthropic.ContentBlock[], fallback: string): RonnieTurn => {
        const text = stripMarkdown(textOf(content)) || fallback
        // A reply cut off by max_tokens can end in a half-written tool call; stored
        // without its result, it would make the next request invalid
        const kept = content.filter((b) => b.type !== 'tool_use')
        return {
            message: text,
            reloadDashboard: executor.needsDashboardReload,
            messages: [...history, { role: 'assistant', content: kept.length ? kept : [{ type: 'text', text }] }],
            toolCalls,
            usage,
            servedModel,
        }
    }
    const sorry = language === 'zh-TW' ? '抱歉，請再問一次。' : 'Sorry, please try again.'
    // The model now and then ends a turn with no text at all; one fresh sample usually answers
    let emptyRetries = 0

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // Out of tool rounds: one last call without tools, so the work done so far
        // is summarised instead of being thrown away
        const lastRound = round === MAX_TOOL_ROUNDS
        const response = await client.messages.create({
            model,
            max_tokens: 1024,
            system,
            tools: RONNIE_TOOLS,
            ...(lastRound ? { tool_choice: { type: 'none' as const } } : {}),
            messages: compactHistory(history),
        })
        usage.push(response.usage)
        servedModel = response.model

        if (response.stop_reason !== 'tool_use') {
            if (!textOf(response.content).trim() && !lastRound && emptyRetries++ < 1) continue
            // end_turn, or a reply cut off by max_tokens: either way, answer with what there is
            return finish(response.content, sorry)
        }

        const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolUseBlocks.map(async (tb) => {
                const input = tb.input as Record<string, string>
                const result = await executor.executeTool(tb.name, input)
                toolCalls.push({ name: tb.name, input, result })
                return { type: 'tool_result' as const, tool_use_id: tb.id, content: result }
            })
        )
        history.push({ role: 'assistant', content: response.content }, { role: 'user', content: toolResults })
    }

    // Unreachable: the last round runs with tool_choice none
    return finish([], sorry)
}
