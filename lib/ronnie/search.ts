import type { LibraryExercise } from './data'
import { MUSCLE_GROUP_LABELS } from '../exercise-display'

// Exercise search, ranked in code. The eval found exact-substring search failing
// on ordinary requests: "face pulls" (library: Face Pull), "burpees", "incline
// bench press" (library: Incline Barbell Press), 反向蝴蝶機 (library: 反向飛鳥機).
// So the search tolerates plurals, word order, partial names and near-miss
// Chinese names, and says when nothing matched exactly.

// A query that names a muscle group ("core", "肩", "後三角") also surfaces that group's exercises
const MUSCLE_GROUP_WORDS: Record<string, string[]> = {
    chest: ['chest', 'pec', '胸'],
    back: ['back', 'lat', '背'],
    shoulders: ['shoulder', 'delt', '肩', '三角'],
    biceps: ['bicep', '二頭'],
    triceps: ['tricep', '三頭'],
    legs: ['leg', 'quad', 'hamstring', '腿'],
    glutes: ['glute', '臀'],
    core: ['core', 'ab', 'abs', '核心', '腹'],
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'for', 'my', 'to', 'and', 'some', 'exercise', 'exercises'])

function singular(word: string): string {
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
    if (word.length > 4 && /(ches|shes|xes)$/.test(word)) return word.slice(0, -2)
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
    return word
}

export function latinTokens(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w && !STOP_WORDS.has(w))
        .map(singular)
}

function cjkBigrams(text: string): Set<string> {
    const chars = [...text.replace(/[^一-鿿]/g, '')]
    const grams = new Set<string>()
    for (let i = 0; i < chars.length - 1; i++) grams.add(chars[i] + chars[i + 1])
    return grams
}

export interface SearchResult {
    exercises: LibraryExercise[]
    /** False when no name contains the query: the results are only the closest matches. */
    exact: boolean
}

export function searchLibrary(
    library: LibraryExercise[],
    query: string | undefined,
    muscleGroup: string | undefined,
    limit = 10
): SearchResult {
    const pool = muscleGroup ? library.filter((e) => e.muscle_group === muscleGroup) : library
    const q = query?.trim() ?? ''
    if (!q) return { exercises: pool.slice(0, limit), exact: true }

    const qLower = q.toLowerCase()
    const qTokens = latinTokens(q)
    const qGrams = cjkBigrams(q)
    const groups = new Set(
        Object.entries(MUSCLE_GROUP_WORDS)
            .filter(([, words]) => words.some((w) => (/[a-z]/.test(w) ? qTokens.includes(w) : q.includes(w))))
            .map(([group]) => group)
    )
    let exact = false

    const scored = pool.map((e) => {
        const name = e.name.toLowerCase()
        const zh = e.name_zh_tw ?? ''
        let score = 0
        if (name === qLower || zh === q) score += 100
        // The whole query inside the name, or a whole Chinese name inside the query
        if (name.includes(qLower) || (zh && (zh.includes(q) || q.includes(zh)))) {
            score += 50
            exact = true
        }
        if (qTokens.length) {
            const nameTokens = new Set(latinTokens(e.name))
            const matched = qTokens.filter((t) => nameTokens.has(t)).length
            if (matched === qTokens.length) exact = true
            score += (30 * matched) / qTokens.length
        }
        if (zh && qGrams.size) {
            const zhGrams = cjkBigrams(zh)
            const shared = [...qGrams].filter((g) => zhGrams.has(g)).length
            score += (20 * shared) / Math.max(qGrams.size, zhGrams.size)
        }
        if (groups.has(e.muscle_group)) {
            score += 15
            if (qTokens.length <= 1 && qGrams.size <= 1) exact = true // the query was just the muscle group
        }
        return { e, score }
    })

    return {
        exercises: scored
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((x) => x.e),
        exact,
    }
}

const EQUIPMENT_ZH: Record<string, string> = {
    barbell: '槓鈴', dumbbell: '啞鈴', cable: '繩索', machine: '器械',
    bodyweight: '徒手', plates: '槓片', kettlebell: '壺鈴', other: '其他',
}

/**
 * The text embedded for an exercise in vector search: both names, plus muscle group and
 * equipment in both languages, so "練胸的啞鈴動作" can match on more than the name.
 */
export function exerciseDocument(e: LibraryExercise & { equipment?: string | null }): string {
    const group = `${MUSCLE_GROUP_LABELS.en[e.muscle_group] ?? e.muscle_group} ${MUSCLE_GROUP_LABELS['zh-TW'][e.muscle_group] ?? ''}`.trim()
    const equipment = e.equipment ? `${e.equipment} ${EQUIPMENT_ZH[e.equipment] ?? ''}`.trim() : ''
    return [e.name, e.name_zh_tw, group, equipment].filter(Boolean).join(' | ')
}
