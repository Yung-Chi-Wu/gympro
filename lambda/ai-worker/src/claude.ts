import Anthropic from '@anthropic-ai/sdk'
import { getSecret } from './secrets'

let cachedClient: Anthropic | null = null

// The Anthropic client, keyed from SSM; the report narrative and the eval judge share it
export async function getClaudeClient(): Promise<Anthropic> {
    if (cachedClient) return cachedClient
    const parameterName = process.env.ANTHROPIC_API_KEY_PARAM
    if (!parameterName) {
        throw new Error('ANTHROPIC_API_KEY_PARAM environment variable is not set')
    }
    const apiKey = await getSecret(parameterName)
    cachedClient = new Anthropic({ apiKey })
    return cachedClient
}
