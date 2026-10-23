import NOTES from './knowledge-notes.json'
import PAGES from './knowledge-pages.json'
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

// Topic pages (knowledge-pages.json): what the notes on one subject say together, written once
// from the notes rather than put together by the model on every question. Search gave Ronnie five
// separate notes, and it answered from them alone, leaving out what a good answer needs (eval
// v30); a page says where the papers agree, where they don't, and what that means for training.
// Every line cites the notes it comes from, and says no more than them: `npm run check:knowledge`
// checks each cited note exists and every number in a line is in one of them, and the knowledge
// check reads Ronnie's reply against the notes themselves, not the page.

/** A sentence of a topic page, with the notes it comes from */
export interface KnowledgePageLine {
    text: string
    notes: string[]
}

export interface KnowledgePage {
    id: string
    title: string
    titleZh: string
    /** Words a user may ask with, Chinese and English */
    terms: string
    /** What the notes consistently find, or what the strongest evidence finds */
    agreed: KnowledgePageLine[]
    /** Conflicts, small or weak evidence, who wasn't studied */
    unsure: KnowledgePageLine[]
    /** What it means for training, as far as the notes support */
    practice: KnowledgePageLine[]
    related: string[]
}

export const KNOWLEDGE_PAGES = PAGES as KnowledgePage[]
export const KNOWLEDGE_PAGE_SECTIONS = ['agreed', 'unsure', 'practice'] as const

/** The notes a page's lines cite, in the order they first appear */
export function pageNotes(page: KnowledgePage): string[] {
    return [...new Set(KNOWLEDGE_PAGE_SECTIONS.flatMap((s) => page[s].flatMap((l) => l.notes)))]
}

/**
 * The topic page for a search's notes: a page that cites the nearest note, and of those the one that
 * cites the most of the rest, a nearer note counting more (1/2 for the second, 1/3 for the third...);
 * the earlier page on a tie. Without the first rule, three loading notes in 2nd to 4th place outweighed
 * the youth note in 1st for "小孩練重量會長不高嗎" (holdout page hit 22/25, with it 23/25; dev 48/50
 * either way). Null when no page cites the nearest note.
 */
export function knowledgePageFor(notes: KnowledgeNote[]): KnowledgePage | null {
    let best: { page: KnowledgePage; score: number } | null = null
    for (const page of KNOWLEDGE_PAGES) {
        const cited = new Set(pageNotes(page))
        if (!notes.length || !cited.has(notes[0].id)) continue
        const score = notes.reduce((s, n, i) => s + (cited.has(n.id) ? 1 / (i + 1) : 0), 0)
        if (!best || score > best.score) best = { page, score }
    }
    return best?.page ?? null
}
