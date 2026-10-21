// Free check of Ronnie's knowledge base (lib/ronnie/knowledge-notes.json): every note has what a
// reader needs (claims, who was studied, design, certainty, a Chinese line in Traditional
// characters, the words people ask with, a full source), ids and DOIs are unique, every paper the
// weekly report cites is in it, and every DOI still resolves at doi.org.
// Run: npm run check:knowledge

import { CARDIO_EVIDENCE, EVIDENCE, GLOSSARY_SOURCES, GOAL_EVIDENCE, PLAN_EVIDENCE } from '../lib/report/evidence'
import { KNOWLEDGE_NOTES, KNOWLEDGE_TOPICS } from '../lib/ronnie/knowledge'

const DOI = /^10\.\d{4,9}\/\S+$/
const ID = /^[a-z0-9]+(-[a-z0-9]+)*-\d{4}-[a-z0-9-]+$/
// Characters only Simplified Chinese uses, as the report's text check counts them
const SIMPLIFIED_ONLY = /[这们训练进动议还时对说体发让点从过关应经]/
const MAX_CLAIM = 450

async function resolves(doi: string): Promise<boolean> {
    // The DOI handle API answers responseCode 1 for a registered DOI, without following it to the publisher
    const res = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi)}`)
    if (!res.ok) return false
    const body = (await res.json()) as { responseCode?: number }
    return body.responseCode === 1
}

async function main() {
    const problems: string[] = []
    const ids = new Set<string>()
    const dois = new Map<string, string>()
    for (const n of KNOWLEDGE_NOTES) {
        const at = n.id || '(no id)'
        if (!ID.test(n.id)) problems.push(`${at}: id is not author-year-subtopic`)
        if (ids.has(n.id)) problems.push(`${at}: id used twice`)
        ids.add(n.id)
        if (!(KNOWLEDGE_TOPICS as readonly string[]).includes(n.topic)) problems.push(`${at}: unknown topic ${n.topic}`)
        if (!n.subtopic?.trim()) problems.push(`${at}: no subtopic`)
        if (!n.claims?.length) problems.push(`${at}: no claims`)
        for (const c of n.claims ?? []) {
            if (!c.trim()) problems.push(`${at}: an empty claim`)
            if (c.length > MAX_CLAIM) problems.push(`${at}: a claim of ${c.length} characters (at most ${MAX_CLAIM})`)
        }
        for (const field of ['population', 'design', 'certainty', 'terms'] as const) if (!n[field]?.trim()) problems.push(`${at}: no ${field}`)
        if (!/[一-鿿]/.test(n.summaryZh ?? '')) problems.push(`${at}: no Chinese line`)
        if (SIMPLIFIED_ONLY.test(n.summaryZh ?? '')) problems.push(`${at}: Simplified characters in its Chinese line`)
        if (!/[一-鿿]/.test(n.terms ?? '') || !/[a-z]/i.test(n.terms ?? '')) problems.push(`${at}: terms need Chinese and English words`)
        const s = n.source
        if (!s?.author || !s.year || !s.title || !s.journal) problems.push(`${at}: incomplete source`)
        if (!DOI.test(s?.doi ?? '')) problems.push(`${at}: malformed DOI ${s?.doi}`)
        else {
            const key = s.doi.toLowerCase()
            if (dois.has(key)) problems.push(`${at}: the same paper as ${dois.get(key)}`)
            dois.set(key, n.id)
        }
        if (s?.pmid && !/^\d+$/.test(s.pmid)) problems.push(`${at}: malformed PMID ${s.pmid}`)
        if (!n.id.startsWith(`${s.author.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.year}-`)) problems.push(`${at}: id doesn't start with its author and year`)
    }

    // The weekly report's papers are Ronnie's too: the two never cite different research for one claim
    const reported = [
        ...Object.values(EVIDENCE).flatMap((e) => e.sources),
        ...Object.values(PLAN_EVIDENCE).flat(),
        ...Object.values(CARDIO_EVIDENCE).flat(),
        ...Object.values(GOAL_EVIDENCE).flat(),
        ...Object.values(GLOSSARY_SOURCES).flatMap((s) => s ?? []),
    ]
    for (const s of reported) if (!dois.has(s.doi.toLowerCase())) problems.push(`the report cites ${s.author} ${s.year} (${s.doi}), which has no note`)

    for (const doi of dois.keys()) {
        if (!(await resolves(doi))) problems.push(`DOI does not resolve: ${doi}`)
    }

    if (problems.length) {
        console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
        process.exit(1)
    }
    const topics = KNOWLEDGE_TOPICS.map((t) => `${t} ${KNOWLEDGE_NOTES.filter((n) => n.topic === t).length}`).join(', ')
    console.log(`ok: ${KNOWLEDGE_NOTES.length} notes (${topics}), ${KNOWLEDGE_NOTES.reduce((s, n) => s + n.claims.length, 0)} claims, ${dois.size} DOIs resolve, every report paper included`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
