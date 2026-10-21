import NOTES from './knowledge-notes.json'
import { latinTokens } from './search'

// Ronnie's knowledge base: one note per paper, written by us from the paper's abstract, never
// its text (the repo is public). Each note says what the paper found, in English claims that
// say no more than the abstract, with who was studied, how sure it is and the DOI, plus a line
// in Chinese and the words a user might ask with. Every DOI was resolved through LibKey and every
// number checked against the abstract (2026-10-21); `npm run check:knowledge` keeps the file honest.
//
// Search finds notes by meaning in the database (knowledge_notes, the same Cohere vectors as
// exercise search), and by keyword here when vectors aren't available. Ronnie cites a note it was
// given; code writes the citation, so a source can't be made up.

export const KNOWLEDGE_TOPICS = ['training', 'concurrent', 'nutrition', 'fatloss', 'populations', 'health', 'pain', 'myths'] as const
export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number]

export interface KnowledgeSource {
    /** First author's surname, or the organization (ACSM) */
    author: string
    year: number
    title: string
    journal: string
    doi: string
    pmid?: string
    /** A statement by an organization, cited by its name with no "et al." */
    organization?: boolean
}

export interface KnowledgeNote {
    /** author-year-subtopic, stable: the database row and every citation use it */
    id: string
    topic: KnowledgeTopic
    subtopic: string
    /** One line in Traditional Chinese, for the user and for search */
    summaryZh: string
    /** What the paper found, each a sentence that says no more than its abstract */
    claims: string[]
    population: string
    design: string
    /** How strong the evidence is, in the paper's or the reviewers' terms */
    certainty: string
    /** What a reader must know: a small trial, a narrative review, a conflict with another note */
    caveats?: string[]
    /** Words a user may ask with, Chinese and English */
    terms: string
    source: KnowledgeSource
}

export const KNOWLEDGE_NOTES = NOTES as KnowledgeNote[]
const byId = new Map(KNOWLEDGE_NOTES.map((n) => [n.id, n]))
export const knowledgeNote = (id: string): KnowledgeNote | undefined => byId.get(id)

/** A paper as a citation: "Pelland et al., 2026", or "ACSM, 2026" for an organization */
export function citationOf(s: KnowledgeSource): string {
    return s.organization ? `${s.author}, ${s.year}` : `${s.author} et al., ${s.year}`
}

/** The text a note's vector is made from: what it's about, its Chinese line, its claims and the words people ask with */
export function knowledgeDocument(n: KnowledgeNote): string {
    return [`${n.topic} / ${n.subtopic}`, n.summaryZh, ...n.claims, n.terms].join('\n')
}

function cjkBigrams(text: string): string[] {
    const out: string[] = []
    for (const run of text.match(/[一-鿿]+/g) ?? []) {
        const chars = [...run]
        if (chars.length === 1) out.push(run)
        for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1])
    }
    return out
}

// What a question shares with a note: whole words in English, two-character pieces in Chinese.
// The words a user asks with (terms) and the subtopic count most, the Chinese line next, the claims
// least: a claim mentions many things in passing.
const FIELD_WEIGHTS: [keyof Pick<KnowledgeNote, 'terms' | 'subtopic' | 'summaryZh'> | 'claims', number][] = [['terms', 3], ['subtopic', 3], ['summaryZh', 2], ['claims', 1]]
// Chinese pieces too common to tell notes apart
const CJK_STOP = new Set(['什麼', '怎麼', '可以', '要不', '不要', '應該', '一下', '還是', '如果', '因為', '所以', '就是', '我的', '我想', '有沒', '沒有', '會不', '不會', '是不', '不是', '多少', '一天', '一週', '的話', '請問'])

const fieldTokens = new Map<string, Map<string, Set<string>>>()
function tokensOf(n: KnowledgeNote, field: string): Set<string> {
    let forNote = fieldTokens.get(n.id)
    if (!forNote) fieldTokens.set(n.id, (forNote = new Map()))
    let tokens = forNote.get(field)
    if (!tokens) {
        const text = field === 'claims' ? n.claims.join(' ') : field === 'subtopic' ? n.subtopic.replace(/-/g, ' ') : String(n[field as keyof KnowledgeNote])
        tokens = new Set([...latinTokens(text), ...cjkBigrams(text)])
        forNote.set(field, tokens)
    }
    return tokens
}

// A word few notes have tells more than one most have ("ibuprofen" against "muscle"): each word
// counts by how rare it is across the notes (inverse document frequency)
let rarity: Map<string, number> | null = null
function rarityOf(word: string): number {
    if (!rarity) {
        const df = new Map<string, number>()
        for (const n of KNOWLEDGE_NOTES) {
            const all = new Set(FIELD_WEIGHTS.flatMap(([field]) => [...tokensOf(n, field)]))
            for (const w of all) df.set(w, (df.get(w) ?? 0) + 1)
        }
        rarity = new Map([...df].map(([w, d]) => [w, Math.log(1 + KNOWLEDGE_NOTES.length / d)]))
    }
    return rarity.get(word) ?? 0
}

/** Notes by keyword, best first; only notes that share a word with the query */
export function searchKnowledgeByKeyword(query: string, limit = 10, notes = KNOWLEDGE_NOTES): KnowledgeNote[] {
    const words = [...new Set([...latinTokens(query), ...cjkBigrams(query)])].filter((w) => !CJK_STOP.has(w))
    if (!words.length) return []
    return notes
        .map((n) => ({ n, score: FIELD_WEIGHTS.reduce((s, [field, weight]) => s + weight * words.filter((w) => tokensOf(n, field).has(w)).reduce((t, w) => t + rarityOf(w), 0), 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.n.id.localeCompare(b.n.id))
        .slice(0, limit)
        .map((x) => x.n)
}

/**
 * The notes for a question. nearestIds are the database's nearest notes by meaning (match_knowledge),
 * which decide alone: on the knowledge eval's holdout questions they put a right note in the top 5
 * for 25 of 25, keywords for 22, and fusing the two for 24, since a word a question shares with an
 * unrelated note by chance ("每天", "部位") pushed the right one down. Keywords are the fallback when
 * vectors aren't available (null: no embedder, or Bedrock failed).
 */
export function searchKnowledge(query: string, nearestIds: string[] | null, limit = 5): KnowledgeNote[] {
    const nearest = (nearestIds ?? []).map(knowledgeNote).filter((n): n is KnowledgeNote => !!n)
    return nearest.length ? nearest.slice(0, limit) : searchKnowledgeByKeyword(query, limit)
}
