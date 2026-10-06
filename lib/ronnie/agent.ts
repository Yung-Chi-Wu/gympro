import type Anthropic from '@anthropic-ai/sdk'
import { stripMarkdown } from './prompt'
import { RONNIE_TOOLS } from './tools'
import type { RonnieExecutor } from './executor'

// Ronnie's agent loop, moved from app/api/ai/coach/route.ts.

export const RONNIE_MODEL = 'claude-haiku-4-5'

export interface RonnieToolCall {
    name: string
    input: Record<string, string>
    result: string
}

export interface RonnieTurn {
    message: string
    reloadDashboard: boolean
    // For the eval runner: every tool call made this turn, and what each API call used
    toolCalls: RonnieToolCall[]
    usage: Anthropic.Usage[]
}

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
    let currentMessages = [...messages]

    for (let i = 0; i < 5; i++) {
        const response = await client.messages.create({
            model,
            max_tokens: 1024,
            system,
            tools: RONNIE_TOOLS,
            messages: currentMessages,
        })
        usage.push(response.usage)

        if (response.stop_reason === 'end_turn') {
            const rawText = response.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as { type: 'text'; text: string }).text)
                .join('')
            return {
                message: stripMarkdown(rawText),
                reloadDashboard: executor.needsDashboardReload,
                toolCalls,
                usage,
            }
        }

        if (response.stop_reason === 'tool_use') {
            const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
            const toolResults: Anthropic.MessageParam = {
                role: 'user',
                content: await Promise.all(
                    toolUseBlocks.map(async (block) => {
                        const tb = block as {
                            type: 'tool_use'
                            id: string
                            name: string
                            input: Record<string, string>
                        }
                        const result = await executor.executeTool(tb.name, tb.input)
                        toolCalls.push({ name: tb.name, input: tb.input, result })
                        return {
                            type: 'tool_result' as const,
                            tool_use_id: tb.id,
                            content: result,
                        }
                    })
                ),
            }

            currentMessages = [
                ...currentMessages,
                { role: 'assistant' as const, content: response.content },
                toolResults,
            ]
        }
    }

    return {
        message: language === 'zh-TW' ? '抱歉，請再問一次。' : 'Sorry, please try again.',
        reloadDashboard: false,
        toolCalls,
        usage,
    }
}
