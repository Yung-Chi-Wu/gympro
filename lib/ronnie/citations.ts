import { citationOf } from './knowledge'
import type { CitedNote } from './executor'

// The sources under a reply, written by code from the notes search_knowledge gave the model this
// turn. The model marks a sentence with a note's key ([K2]); code numbers the notes it cited in the
// order they appear ([1], [2]) and lists each one's paper under the reply, so a source shown is
// always a paper Ronnie was given, never one it named itself. A key that wasn't given is dropped.

/** A paper under a reply, as the chat shows it */
export interface ReplySource {
    /** The number its sentences carry, [1], [2]... */
    n: number
    /** "Pelland et al., 2026" */
    citation: string
    title: string
    journal: string
    doi: string
}

// [K1], [K1, K2], [K1][K2], and the full-width 【K1】 the Chinese replies may use
const MARKER = /[[【]\s*(K\d+(?:\s*[,，、]\s*K\d+)*)\s*[\]】]/g

export interface CitedReply {
    text: string
    sources: ReplySource[]
    /** Keys the reply used that no note had this turn, dropped from the text */
    unknown: string[]
    /** Each cited key's number, to renumber the same markers elsewhere (the stored history) */
    numbers: Map<string, number>
}

const keysOf = (keys: string) => keys.split(/\s*[,，、]\s*/).map((k) => k.trim())

/** The markers in a text as numbers, a key without one dropped */
export function renumber(text: string, numbers: Map<string, number>): string {
    return text
        .replace(MARKER, (_, keys: string) => {
            const ns = [...new Set(keysOf(keys).map((k) => numbers.get(k)).filter((n): n is number => n != null))]
            return ns.length ? `[${ns.join(', ')}]` : ''
        })
        // A marker dropped from before punctuation leaves a space behind
        .replace(/ +([，。！？、；：,.!?;:])/g, '$1')
        .replace(/ {2,}/g, ' ')
        .replace(/ +$/gm, '')
}

export function withSources(reply: string, cited: CitedNote[]): CitedReply {
    const byKey = new Map(cited.map((c) => [c.key, c]))
    const order: CitedNote[] = []
    const unknown = new Set<string>()
    for (const [, keys] of reply.matchAll(MARKER)) {
        for (const key of keysOf(keys)) {
            const c = byKey.get(key)
            if (!c) unknown.add(key)
            else if (!order.includes(c)) order.push(c)
        }
    }
    const numbers = new Map(order.map((c, i) => [c.key, i + 1]))
    return {
        text: renumber(reply, numbers),
        sources: order.map((c, i) => ({ n: i + 1, citation: citationOf(c.note.source), title: c.note.source.title, journal: c.note.source.journal, doi: c.note.source.doi })),
        unknown: [...unknown],
        numbers,
    }
}

/**
 * The first key this turn's notes may take: one past any key earlier turns' search results used
 * today, so a key the model still sees from an earlier turn never means a note given now
 */
export function nextKnowledgeKey(messages: { role: string; content: unknown }[]): number {
    let max = 0
    for (const m of messages) {
        if (m.role !== 'user' || !Array.isArray(m.content)) continue
        for (const b of m.content as { type?: string; content?: unknown }[]) {
            if (b.type !== 'tool_result' || typeof b.content !== 'string') continue
            for (const [, n] of b.content.matchAll(/\[K(\d+)\]/g)) max = Math.max(max, Number(n))
        }
    }
    return max + 1
}
