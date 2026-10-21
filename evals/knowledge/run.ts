import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dot, SEARCH_EMBEDDING_MODEL } from '../../lib/embeddings'
import { cachedEmbedder } from '../shared/embedding-cache'
import { KNOWLEDGE_NOTES, knowledgeDocument, searchKnowledge, searchKnowledgeByKeyword, type KnowledgeNote } from '../../lib/ronnie/knowledge'

const RRF_K = 60
/** Keyword and vector rankings merged by reciprocal rank, as exercise search fuses them: tried, and not chosen */
function fused(lists: KnowledgeNote[][], limit: number): KnowledgeNote[] {
    const scores = new Map<string, { n: KnowledgeNote; score: number }>()
    for (const list of lists) list.forEach((n, i) => {
        const entry = scores.get(n.id) ?? { n, score: 0 }
        entry.score += 1 / (RRF_K + i + 1)
        scores.set(n.id, entry)
    })
    return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.n)
}

// Knowledge-search eval. Each case is a question a user would ask Ronnie, in their words, with
// the notes that answer it (any of them is a right answer). Retrieval is measured on its own: when
// Ronnie answers without a source, this tells "search didn't find it" apart from "the model didn't
// use it".
//
// Metrics:
//   hit@1  a right note is first
//   hit@5  a right note is in the top 5 (what search_knowledge gives Ronnie)
//   MRR    mean of 1 / rank of the first right note (0 if it isn't in the top 10)
//
// Variants:
//   keyword   lib/ronnie/knowledge.ts searchKnowledgeByKeyword, the fallback without vectors. Free;
//             CI runs it (--min-hit5)
//   vector    nearest notes by Cohere v4 embedding, as match_knowledge ranks them: what Ronnie
//             uses (searchKnowledge), chosen on 2026-10-21 (holdout hit@5 100%, hit@1 88%)
//   hybrid    keyword and vector fused by reciprocal rank (holdout 96%, 80%): not chosen
// Embeddings come from Bedrock (AWS_PROFILE, us-east-1) and are cached in .cache/, so a rerun
// costs nothing; all the notes and questions cost under US$0.01 the first time.
//
// Usage:
//   npm run eval:knowledge -- keyword vector hybrid
//   KNOWLEDGE_CASES=holdout npm run eval:knowledge -- ...   the holdout set
//   npm run eval:knowledge -- keyword --min-hit5 0.8          fail below that hit@5 (CI)

const HERE = join(process.cwd(), 'evals', 'knowledge')
const CASE_SET = process.env.KNOWLEDGE_CASES === 'holdout' ? 'holdout' : 'dev'
const CASES_FILE = CASE_SET === 'holdout' ? 'cases-holdout.json' : 'cases.json'
const RESULTS_DIR = join(HERE, 'results', ...(CASE_SET === 'holdout' ? ['holdout'] : []))
const TOP = 10

interface Case {
    id: string
    /** direct, colloquial (how people say it), myth (a belief to check) */
    kind: string
    query: string
    relevant: string[]
}
type Search = (query: string) => Promise<KnowledgeNote[]>

async function vectorRanker(): Promise<(query: string) => Promise<string[]>> {
    const embedTexts = cachedEmbedder(join(HERE, '.cache'), SEARCH_EMBEDDING_MODEL)
    const docs = await embedTexts(KNOWLEDGE_NOTES.map(knowledgeDocument), 'document')
    return async (query) => {
        const [q] = await embedTexts([query], 'query')
        return KNOWLEDGE_NOTES.map((n, i) => ({ id: n.id, s: dot(q, docs[i]) })).sort((a, b) => b.s - a.s).slice(0, 20).map((x) => x.id)
    }
}

async function searchFor(variant: string): Promise<Search> {
    if (variant === 'keyword') return async (q) => searchKnowledgeByKeyword(q, TOP)
    const nearest = await vectorRanker()
    if (variant === 'vector') return async (q) => searchKnowledge(q, await nearest(q), TOP)
    if (variant === 'hybrid') return async (q) => fused([searchKnowledgeByKeyword(q, 20), searchKnowledge(q, await nearest(q), 20)], TOP)
    throw new Error(`unknown variant ${variant}`)
}

async function main() {
    const args = process.argv.slice(2)
    const minAt = args.indexOf('--min-hit5')
    const minHit5 = minAt >= 0 ? Number(args[minAt + 1]) : null
    const variants = args.filter((a, i) => !a.startsWith('--') && (minAt < 0 || i !== minAt + 1))
    if (!variants.length) variants.push('keyword')
    const cases = JSON.parse(readFileSync(join(HERE, CASES_FILE), 'utf8')) as Case[]
    const known = new Set(KNOWLEDGE_NOTES.map((n) => n.id))
    for (const c of cases) for (const id of c.relevant) if (!known.has(id)) throw new Error(`${c.id}: no note ${id}`)

    mkdirSync(RESULTS_DIR, { recursive: true })
    const kinds = [...new Set(cases.map((c) => c.kind))]
    let failed = false
    console.log(`${CASE_SET}: ${KNOWLEDGE_NOTES.length} notes, ${cases.length} questions\n`)
    console.log('variant'.padEnd(10) + 'hit@1'.padStart(8) + 'hit@5'.padStart(8) + 'MRR'.padStart(8) + kinds.map((k) => `${k}@5`.padStart(14)).join(''))
    for (const variant of variants) {
        const search = await searchFor(variant)
        const results: { id: string; kind: string; query: string; rank: number | null; top5: string[] }[] = []
        for (const c of cases) {
            const got = (await search(c.query)).map((n) => n.id)
            const rank = got.findIndex((id) => c.relevant.includes(id)) + 1
            results.push({ id: c.id, kind: c.kind, query: c.query, rank: rank || null, top5: got.slice(0, 5) })
        }
        const share = (rs: typeof results, f: (r: (typeof results)[number]) => boolean) => rs.filter(f).length / Math.max(1, rs.length)
        const hit1 = share(results, (r) => r.rank === 1)
        const hit5 = share(results, (r) => !!r.rank && r.rank <= 5)
        const mrr = results.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / results.length
        const pct = (x: number) => `${Math.round(x * 100)}%`
        console.log(variant.padEnd(10) + pct(hit1).padStart(8) + pct(hit5).padStart(8) + mrr.toFixed(2).padStart(8)
            + kinds.map((k) => pct(share(results.filter((r) => r.kind === k), (r) => !!r.rank && r.rank <= 5)).padStart(14)).join(''))
        for (const r of results.filter((x) => !x.rank || x.rank > 5)) console.log(`    miss ${r.id}: "${r.query}" -> ${r.top5.slice(0, 3).join(', ')}`)
        writeFileSync(join(RESULTS_DIR, `${variant}.json`), JSON.stringify({ variant, summary: { hit1, hit5, mrr }, results }, null, 2) + '\n')
        if (minHit5 != null && hit5 < minHit5) {
            console.error(`${variant}: hit@5 ${pct(hit5)} is under ${pct(minHit5)}`)
            failed = true
        }
    }
    if (failed) process.exit(1)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
