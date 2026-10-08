import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { dot, embed, EMBEDDING_MODELS, type EmbeddingModel } from '../../lib/embeddings'
import { exerciseDocument, searchLibrary } from '../../lib/ronnie/search'
import type { LibraryExercise } from '../../lib/ronnie/data'

// Exercise-search eval. Each case is a query that a user, or Ronnie, would send to
// search_exercises, together with the library exercises that are right answers.
//
// Retrieval is measured on its own: when Ronnie recommends the wrong exercise, this
// tells "search didn't find it" apart from "it was found and the model picked badly".
//
// Metrics:
//   hit@1  a right answer is first
//   hit@5  a right answer is in the top 5 (what Ronnie mostly reads)
//   MRR    mean of 1 / rank of the first right answer (0 if it isn't in the top 10)
//
// Variants:
//   keyword                     the current search (lib/ronnie/search.ts). Free.
//   vector:<model>[:names]      nearest exercises by embedding. ":names" embeds only
//                               the two names instead of exerciseDocument.
//   hybrid:<model>[:names]      keyword and vector ranks merged with RRF
//   gated:<model>[:names]       hybrid only when the keyword search matched a name
//                               (its exact flag); otherwise vector alone. A partial
//                               keyword match ("romanain deadlift" -> Deadlift) is noise.
// Embeddings come from Bedrock (AWS_PROFILE, us-east-1) and are cached in .cache/,
// so a rerun costs nothing.
//
// Usage:
//   npm run eval:search -- keyword hybrid:titan-v2 ...
// Each variant's results are saved to results/<variant>.json.

const HERE = join(process.cwd(), 'evals', 'search')
const TOP = 10
// Each list contributes 1 / (RRF_K + rank). 60 is the usual constant: a high rank in
// one list counts, but an exercise ranked well in both lists comes first.
const RRF_K = 60
const POOL = 20

interface Case {
    id: string
    /** exact, partial, typo, alias, cross-language, descriptive */
    kind: string
    query: string
    muscle_group?: string
    /** English library names; any of them is a right answer */
    relevant: string[]
}

type Exercise = LibraryExercise & { equipment: string | null }
type Search = (query: string, muscleGroup: string | undefined) => Promise<LibraryExercise[]>

/** The cleaned library, the same rows as the migrated database. Quoted fields may hold commas. */
function loadLibrary(): Exercise[] {
    const rows = readFileSync(join(HERE, 'library.csv'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map((m) => m[1].replace(/^"|"$/g, '').replace(/""/g, '"')))
    const [header, ...data] = rows
    const col = (name: string) => header.indexOf(name)
    return data.map((r) => ({
        id: r[col('id')],
        name: r[col('name')],
        name_zh_tw: r[col('name_zh_tw')] || null,
        muscle_group: r[col('muscle_group')],
        equipment: r[col('equipment')] || null,
    }))
}

/** Embeddings by model and text, kept on disk so each text is paid for once. */
async function cachedEmbed(client: BedrockRuntimeClient, model: EmbeddingModel, texts: string[], kind: 'document' | 'query') {
    const dir = join(HERE, '.cache')
    const file = join(dir, `${model}.json`)
    const cache: Record<string, number[]> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    const key = (t: string) => createHash('sha1').update(`${kind}\n${t}`).digest('hex')
    const missing = [...new Set(texts.filter((t) => !cache[key(t)]))]
    if (missing.length) {
        const vectors = await embed(client, model, missing, kind)
        missing.forEach((t, i) => (cache[key(t)] = vectors[i]))
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, JSON.stringify(cache))
        console.log(`  embedded ${missing.length} ${kind} texts with ${model}`)
    }
    return texts.map((t) => cache[key(t)])
}

/** Reciprocal rank fusion: each list adds 1 / (RRF_K + rank) to an exercise's score. */
function fuse(lists: LibraryExercise[][]): LibraryExercise[] {
    const scores = new Map<string, { e: LibraryExercise; score: number }>()
    for (const list of lists) {
        list.forEach((e, i) => {
            const entry = scores.get(e.id) ?? { e, score: 0 }
            entry.score += 1 / (RRF_K + i + 1)
            scores.set(e.id, entry)
        })
    }
    return [...scores.values()].sort((a, b) => b.score - a.score).map((x) => x.e)
}

async function makeSearch(variant: string, library: Exercise[], cases: Case[], client: BedrockRuntimeClient): Promise<Search> {
    const keyword: Search = async (q, mg) => searchLibrary(library, q, mg, POOL).exercises
    if (variant === 'keyword') return keyword

    const [mode, model, format] = variant.split(':') as [string, EmbeddingModel, string | undefined]
    if (!['vector', 'hybrid', 'gated'].includes(mode) || !(model in EMBEDDING_MODELS)) throw new Error(`Unknown variant ${variant}`)
    const documents = library.map((e) => (format === 'names' ? [e.name, e.name_zh_tw].filter(Boolean).join(' | ') : exerciseDocument(e)))
    const docVectors = await cachedEmbed(client, model, documents, 'document')
    const queryVectors = new Map((await cachedEmbed(client, model, cases.map((c) => c.query), 'query')).map((v, i) => [cases[i].query, v]))

    const vector: Search = async (q, mg) => {
        const qv = queryVectors.get(q)!
        return library
            .map((e, i) => ({ e, score: dot(qv, docVectors[i]) }))
            .filter((x) => !mg || x.e.muscle_group === mg)
            .sort((a, b) => b.score - a.score)
            .slice(0, POOL)
            .map((x) => x.e)
    }
    if (mode === 'vector') return vector
    if (mode === 'hybrid') return async (q, mg) => fuse([await keyword(q, mg), await vector(q, mg)])
    return async (q, mg) => {
        const k = searchLibrary(library, q, mg, POOL)
        return k.exact ? fuse([k.exercises, await vector(q, mg)]) : vector(q, mg)
    }
}

async function main() {
    const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['keyword']
    const library = loadLibrary()
    const cases: Case[] = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'))
    const client = new BedrockRuntimeClient({ region: 'us-east-1' })

    // A label naming an exercise the library doesn't have would silently count as a miss
    const names = new Set(library.map((e) => e.name))
    const unknown = cases.flatMap((c) => c.relevant.filter((n) => !names.has(n)).map((n) => `${c.id}: ${n}`))
    if (unknown.length) throw new Error(`Not in the library:\n${unknown.join('\n')}`)

    const summarise = (rs: { rank: number }[]) => ({
        n: rs.length,
        hit1: rs.filter((r) => r.rank === 1).length / rs.length,
        hit5: rs.filter((r) => r.rank >= 1 && r.rank <= 5).length / rs.length,
        mrr: rs.reduce((s, r) => s + (r.rank && r.rank <= TOP ? 1 / r.rank : 0), 0) / rs.length,
    })
    const kinds = [...new Set(cases.map((c) => c.kind))]
    const table: Record<string, Record<string, ReturnType<typeof summarise>>> = {}

    for (const variant of variants) {
        const search = await makeSearch(variant, library, cases, client)
        const results = await Promise.all(cases.map(async (c) => {
            const found = (await search(c.query, c.muscle_group)).slice(0, TOP)
            const rank = found.findIndex((e) => c.relevant.includes(e.name)) + 1 // 0 = not found
            return { ...c, rank, top: found.slice(0, 5).map((e) => `${e.name} / ${e.name_zh_tw ?? ''}`) }
        }))
        table[variant] = Object.fromEntries([...kinds.map((k) => [k, summarise(results.filter((r) => r.kind === k))]), ['ALL', summarise(results)]])

        mkdirSync(join(HERE, 'results'), { recursive: true })
        writeFileSync(join(HERE, 'results', `${variant.replace(/:/g, '-')}.json`), JSON.stringify({ variant, summary: table[variant].ALL, results }, null, 2) + '\n')

        const misses = results.filter((r) => !r.rank || r.rank > 5)
        console.log(`\n${variant}: not in the top 5 (${misses.length})`)
        for (const m of misses) console.log(`  [${m.kind}] "${m.query}" -> ${m.top.slice(0, 3).join(', ') || '(nothing)'}`)
    }

    const pct = (x: number) => `${Math.round(x * 100)}%`
    const width = Math.max(...variants.map((v) => v.length), 8) + 2
    console.log(`\nhit@5 by kind (${library.length} exercises, ${cases.length} queries)\n`)
    console.log('kind'.padEnd(16) + variants.map((v) => v.padStart(width)).join(''))
    for (const k of [...kinds, 'ALL']) console.log(k.padEnd(16) + variants.map((v) => pct(table[v][k].hit5).padStart(width)).join(''))
    console.log('\n' + 'ALL hit@1'.padEnd(16) + variants.map((v) => pct(table[v].ALL.hit1).padStart(width)).join(''))
    console.log('ALL MRR'.padEnd(16) + variants.map((v) => table[v].ALL.mrr.toFixed(2).padStart(width)).join(''))
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
