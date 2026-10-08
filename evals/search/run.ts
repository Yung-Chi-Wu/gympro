import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { searchLibrary } from '../../lib/ronnie/search'
import type { LibraryExercise } from '../../lib/ronnie/data'

// Exercise-search eval. No model calls, so it's free to run. Each case is a query that
// a user, or Ronnie, would send to search_exercises, together with the library
// exercises that are right answers.
//
// Retrieval is measured on its own: when Ronnie recommends the wrong exercise, this
// tells "search didn't find it" apart from "it was found and the model picked badly".
//
// Metrics:
//   hit@1  a right answer is first
//   hit@5  a right answer is in the top 5 (what Ronnie mostly reads)
//   MRR    mean of 1 / rank of the first right answer (0 if it isn't in the top 10)
//
// Usage:
//   npm run eval:search -- <label>
// Results are saved to results/<label>.json, so variants can be compared.

const HERE = join(process.cwd(), 'evals', 'search')
const TOP = 10

interface Case {
    id: string
    /** exact, partial, typo, alias, cross-language, descriptive */
    kind: string
    query: string
    muscle_group?: string
    /** English library names; any of them is a right answer */
    relevant: string[]
}

type Search = (query: string, muscleGroup: string | undefined) => Promise<LibraryExercise[]>

/** The library as exported from Supabase (built-in exercises only). Quoted fields may hold commas. */
function loadLibrary(): LibraryExercise[] {
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
    }))
}

async function main() {
    const label = process.argv[2] ?? 'keyword'
    const library = loadLibrary()
    const cases: Case[] = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'))

    // A label naming an exercise the library doesn't have would silently count as a miss
    const names = new Set(library.map((e) => e.name))
    const unknown = cases.flatMap((c) => c.relevant.filter((n) => !names.has(n)).map((n) => `${c.id}: ${n}`))
    if (unknown.length) throw new Error(`Not in the library:\n${unknown.join('\n')}`)

    const search: Search = async (q, mg) => searchLibrary(library, q, mg, TOP).exercises

    const results = await Promise.all(cases.map(async (c) => {
        const found = await search(c.query, c.muscle_group)
        const rank = found.findIndex((e) => c.relevant.includes(e.name)) + 1 // 0 = not found
        return { ...c, rank, top: found.slice(0, 5).map((e) => `${e.name} / ${e.name_zh_tw ?? ''}`) }
    }))

    const summarise = (rs: typeof results) => ({
        n: rs.length,
        hit1: rs.filter((r) => r.rank === 1).length / rs.length,
        hit5: rs.filter((r) => r.rank >= 1 && r.rank <= 5).length / rs.length,
        mrr: rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rs.length,
    })
    const kinds = [...new Set(cases.map((c) => c.kind))]
    const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5)
    console.log(`\n${label}: ${library.length} exercises, ${cases.length} queries\n`)
    console.log('kind              n  hit@1  hit@5   MRR')
    for (const [name, s] of [...kinds.map((k) => [k, summarise(results.filter((r) => r.kind === k))] as const), ['ALL', summarise(results)] as const]) {
        console.log(`${name.padEnd(15)} ${String(s.n).padStart(3)}  ${pct(s.hit1)}  ${pct(s.hit5)}  ${s.mrr.toFixed(2)}`)
    }

    const misses = results.filter((r) => !r.rank || r.rank > 5)
    if (misses.length) {
        console.log(`\nNot in the top 5 (${misses.length}):`)
        for (const m of misses) console.log(`  [${m.kind}] "${m.query}" -> wanted ${m.relevant.join(' | ')}; got ${m.top.join(', ') || '(nothing)'}`)
    }

    mkdirSync(join(HERE, 'results'), { recursive: true })
    writeFileSync(join(HERE, 'results', `${label}.json`), JSON.stringify({ label, summary: summarise(results), results }, null, 2) + '\n')
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
