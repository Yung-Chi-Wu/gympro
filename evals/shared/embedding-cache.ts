import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { embed, type EmbedKind, type EmbeddingModel } from '../../lib/embeddings'

/**
 * Embeddings for the evals, cached on disk by model, kind and text, so each text is
 * paid for once and a rerun is free. Uses the AWS credentials in the environment
 * (AWS_PROFILE) in us-east-1.
 */
export function cachedEmbedder(dir: string, model: EmbeddingModel) {
    const client = new BedrockRuntimeClient({ region: 'us-east-1' })
    const file = join(dir, `${model}.json`)
    let cache: Record<string, number[]> | null = null
    const key = (kind: EmbedKind, text: string) => createHash('sha1').update(`${kind}\n${text}`).digest('hex')

    return async function embedTexts(texts: string[], kind: EmbedKind): Promise<number[][]> {
        cache ??= existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
        const store = cache!
        const missing = [...new Set(texts.filter((t) => !store[key(kind, t)]))]
        if (missing.length) {
            const vectors = await embed(client, model, missing, kind)
            missing.forEach((t, i) => (store[key(kind, t)] = vectors[i]))
            mkdirSync(dir, { recursive: true })
            writeFileSync(file, JSON.stringify(store))
        }
        return texts.map((t) => store[key(kind, t)])
    }
}
