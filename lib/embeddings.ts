import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'

// Text embeddings on Amazon Bedrock, for the exercise search. A model turns a text into
// a vector, and texts that mean the same thing land close together in any language
// ("上胸" near "Incline Bench Press"). Documents and queries must go through the same
// model, because vectors from different models aren't comparable. Cohere embeds the two
// differently on purpose (input_type), so callers say which kind each text is.
// Every vector comes back unit length, so cosine similarity is a dot product.

export type EmbeddingModel = 'titan-v2' | 'cohere-multilingual-v3' | 'cohere-v4'
export type EmbedKind = 'document' | 'query'

/**
 * The model Ronnie's exercise search uses, chosen by the search eval (evals/search).
 * On the 20 holdout queries it reached 90% hit@5, against 75% for keyword search and
 * 70% for Titan V2. The database column must have the same dimensions.
 */
export const SEARCH_EMBEDDING_MODEL: EmbeddingModel = 'cohere-v4'
export const SEARCH_EMBEDDING_DIMENSIONS = 1536
const BEDROCK_REGION = 'us-east-1'

interface ModelSpec {
    id: string
    /** Texts per request */
    batch: number
    body: (texts: string[], kind: EmbedKind) => unknown
    read: (response: Record<string, unknown>) => number[][]
}

const cohereInput = (kind: EmbedKind) => (kind === 'query' ? 'search_query' : 'search_document')

export const EMBEDDING_MODELS: Record<EmbeddingModel, ModelSpec> = {
    'titan-v2': {
        id: 'amazon.titan-embed-text-v2:0',
        batch: 1,
        body: ([text]) => ({ inputText: text, dimensions: 1024, normalize: true }),
        read: (r) => [r.embedding as number[]],
    },
    'cohere-multilingual-v3': {
        id: 'cohere.embed-multilingual-v3',
        batch: 96,
        body: (texts, kind) => ({ texts, input_type: cohereInput(kind) }),
        read: (r) => r.embeddings as number[][],
    },
    'cohere-v4': {
        id: 'cohere.embed-v4:0',
        batch: 96,
        body: (texts, kind) => ({ texts, input_type: cohereInput(kind), embedding_types: ['float'] }),
        read: (r) => (r.embeddings as { float: number[][] }).float,
    },
}

function unit(v: number[]): number[] {
    const norm = Math.hypot(...v)
    return norm ? v.map((x) => x / norm) : v
}

export function dot(a: number[], b: number[]): number {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * b[i]
    return s
}

export async function embed(
    client: BedrockRuntimeClient,
    model: EmbeddingModel,
    texts: string[],
    kind: EmbedKind,
    signal?: AbortSignal,
): Promise<number[][]> {
    const spec = EMBEDDING_MODELS[model]
    const batches: string[][] = []
    for (let i = 0; i < texts.length; i += spec.batch) batches.push(texts.slice(i, i + spec.batch))

    const out: number[][][] = new Array(batches.length)
    // A few requests at a time: Titan takes one text per request
    let next = 0
    await Promise.all(Array.from({ length: Math.min(8, batches.length) }, async () => {
        while (next < batches.length) {
            const i = next++
            const response = await client.send(new InvokeModelCommand({
                modelId: spec.id,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify(spec.body(batches[i], kind)),
            }), { abortSignal: signal })
            out[i] = spec.read(JSON.parse(new TextDecoder().decode(response.body))).map(unit)
        }
    }))
    return out.flat()
}

/**
 * Embeds one search query on Vercel, with the deployment's OIDC role, or null where
 * there is no role (local dev). Callers fall back to keyword search on null or on an error.
 */
export function vercelQueryEmbedder(timeoutMs = 2000): ((text: string) => Promise<number[]>) | null {
    const roleArn = process.env.AWS_ROLE_ARN
    if (!roleArn) return null
    const client = new BedrockRuntimeClient({ region: BEDROCK_REGION, credentials: awsCredentialsProvider({ roleArn }) })
    return async (text) => (await embed(client, SEARCH_EMBEDDING_MODEL, [text], 'query', AbortSignal.timeout(timeoutMs)))[0]
}
