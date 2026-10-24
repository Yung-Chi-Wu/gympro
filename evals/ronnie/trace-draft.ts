// From a flagged production trace to a draft replay (evals/ronnie/replays/*.json) that a person
// reviews before it's committed. The repo is public and a production trace is a real
// conversation, so:
// - the replay's own fields hold only what a replay needs, moved onto the fixture user where code
//   can do it: exercise IDs become fixture names, the user's name becomes Alex, and the lines the
//   app adds to a reply are left out (the replay's code adds them again);
// - what a reviewer needs to judge it goes under `review`: a to-do list, the flags, the day's
//   earlier messages, each tool's result and the reply shown. It never goes in the repo:
//   replayProblems, run by check-replays.mjs, refuses a replay that still has `review`, an exercise
//   the fixture doesn't have, or no `why`.
// scripts/trace-to-case.ts reads the traces and writes the drafts; this file only converts.
import library from '../../supabase/data/exercise-attributes.json'
import { ownTextOf, toolCallsOf } from '../../lambda/ai-worker/src/audit/turns'
import { EXERCISES } from './fixture'

/** A Ronnie trace as ai_traces keeps it (app/api/ai/coach/route.ts) */
export interface ProductionTrace {
    id: string
    created_at: string
    status: string
    input: {
        language?: string
        message?: string
        system?: string
        history?: unknown[]
        editFrom?: number | null
        truncated?: boolean
    } | null
    output: {
        reply?: string
        messages?: unknown[]
        replyCheck?: { claimed?: string[]; fixed?: boolean; draft?: string }
        sources?: unknown[]
        toolCalls?: { name: string; input: unknown }[]
        truncated?: boolean
    } | null
}

/** A flag on the trace (ai_trace_flags) */
export interface TraceFlag {
    kind: string
    detail: unknown
}

export type ReplayStep = { tool: string; input: Record<string, unknown> } | { reply: string }

export interface Replay {
    id: string
    source: string
    why: string
    language: 'zh-TW' | 'en'
    user: string
    model: ReplayStep[]
    retry?: string
    expect: { claimed?: string[]; fixed?: boolean; writes?: number; shownIncludes?: string[]; shownExcludes?: string[] }
}

export interface Draft extends Replay {
    review: {
        /** What has to be done before this is a replay; delete `review` when it's all done */
        todo: string[]
        flags: TraceFlag[]
        /** Each exercise ID in the tools' input: its library exercise and the fixture one it became */
        exercises: { id: string; library: string | null; fixture: string | null; by: 'name' | 'attributes' | null }[]
        /** The day's messages before this one, as the user and Ronnie said them */
        earlier: string[]
        /** What each tool returned, on the user's real data */
        tools: { name: string; input: unknown; result: string }[]
        /** The reply as the user saw it, with the app's lines */
        shown: string
    }
}

// ---------- Exercises: production ID → library row → fixture exercise ----------

export interface LibraryRow {
    id: string
    name: string
    nameZh?: string
    primary?: string[]
    secondary?: string[]
    jointLoad?: Record<string, string>
    equipment?: string
    stability?: string
}
const LIBRARY = library as LibraryRow[]

const normal = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '')
const signature = (primary?: string[], secondary?: string[], jointLoad?: Record<string, string> | null, equipment?: string | null, stability?: string | null) =>
    JSON.stringify([[...(primary ?? [])].sort(), [...(secondary ?? [])].sort(), Object.entries(jointLoad ?? {}).sort(), equipment ?? null, stability ?? null])

/** The library exercise an ID from a trace names: the whole ID, or the 8-character one tool results show */
export function libraryRowFor(id: string): LibraryRow | null {
    const found = LIBRARY.filter((row) => row.id.startsWith(id))
    return id.length >= 8 && found.length === 1 ? found[0] : null
}

/**
 * The fixture exercise a library exercise stands for: the one with its English or Chinese name,
 * else the only one with its muscles, joint load, equipment and stability (the fixture takes these
 * from the library, under a few shorter names)
 */
export function fixtureExerciseFor(row: LibraryRow): { name: string; by: 'name' | 'attributes' } | null {
    const byName = EXERCISES.filter((e) => normal(e.name) === normal(row.name) || (row.nameZh && normal(e.name_zh_tw) === normal(row.nameZh)))
    if (byName.length === 1) return { name: byName[0].name, by: 'name' }
    const mine = signature(row.primary, row.secondary, row.jointLoad, row.equipment, row.stability)
    const byAttributes = EXERCISES.filter((e) =>
        signature(e.primary_muscles as string[], e.secondary_muscles as string[], e.joint_load as Record<string, string>, e.equipment, e.stability_demand) === mine)
    return byAttributes.length === 1 ? { name: byAttributes[0].name, by: 'attributes' } : null
}

/** Marks an exercise the fixture doesn't have: replayProblems refuses it until a person picks one */
export const UNMAPPED = '@?'

// ---------- The draft ----------

const APP_LINE = /^(📝|📋|📌|💊)/u
const isEventText = (text: string) => text.startsWith('[App event]')

const blocksOf = (message: unknown): { type?: string; text?: string; name?: string; input?: unknown }[] => {
    const content = (message as { content?: unknown })?.content
    return typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
}
const textOf = (message: unknown) => blocksOf(message).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!).join('\n').trim()
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** The name in the system prompt's "User: <name>. Goal:" line, or null when it isn't set */
export function displayNameIn(system: string | undefined): string | null {
    const name = system?.match(/^User: (.+?)\. Goal: /m)?.[1]?.trim()
    return name && name !== 'name not set' && name.length >= 2 ? name : null
}

export function traceToDraft(trace: ProductionTrace, flags: TraceFlag[]): Draft {
    const todo: string[] = ['Write `why`: what went wrong in this conversation, and what the replay checks.']
    const input = trace.input ?? {}
    const output = trace.output ?? {}
    const language = input.language === 'en' ? 'en' : 'zh-TW'
    const name = displayNameIn(input.system)
    const asAlex = (text: string) => (name ? text.split(name).join('Alex') : text)
    const short = trace.id.slice(0, 8)
    const day = trace.created_at.slice(0, 10)

    // Exercise IDs in the tools' input become fixture names; anything else that is the user's own is listed
    const exercises: Draft['review']['exercises'] = []
    const routines = new Set<string>()
    const mapId = (value: unknown): unknown => {
        if (typeof value !== 'string') return value
        const row = libraryRowFor(value)
        const fixture = row ? fixtureExerciseFor(row) : null
        if (!exercises.some((e) => e.id === value)) exercises.push({ id: value, library: row?.name ?? null, fixture: fixture?.name ?? null, by: fixture?.by ?? null })
        return fixture ? `@${fixture.name}` : `${UNMAPPED}${value}${row ? ` (${row.name})` : ''}`
    }
    const mapInput = (raw: unknown): Record<string, unknown> => Object.fromEntries(Object.entries((raw ?? {}) as Record<string, unknown>).map(([key, value]) => {
        if (/exercise_id$/.test(key)) return [key, mapId(value)]
        if (key === 'include' && Array.isArray(value)) return [key, value.map(mapId)]
        if (key === 'routine_name' && typeof value === 'string') routines.add(value)
        return [key, value]
    }))

    const messages = Array.isArray(output.messages) ? output.messages : []
    const model: ReplayStep[] = messages.length
        ? messages.filter((m) => (m as { role?: string })?.role === 'assistant')
            .flatMap((m) => blocksOf(m).filter((b) => b.type === 'tool_use').map((b) => ({ tool: String(b.name), input: mapInput(b.input) })))
        : (output.toolCalls ?? []).map((c) => ({ tool: c.name, input: mapInput(c.input) }))

    // Ronnie's own words, without the lines the app adds (the replay's code adds them again)
    const own = asAlex(ownTextOf(messages).split(/\n{2,}/).filter((p) => !APP_LINE.test(p.trim())).join('\n\n').trim())
    const check = output.replyCheck
    const caught = check?.claimed?.length && typeof check.draft === 'string' ? check : null
    if (caught) model.push({ reply: asAlex(caught.draft!) })
    else if (own) model.push({ reply: own })

    const writes = model.filter((s) => 'tool' in s && (s.tool === 'add_exercise_today' || s.tool === 'remove_exercise_today')).length
    const expect: Replay['expect'] = {
        ...(caught ? { claimed: caught.claimed, fixed: caught.fixed ?? false } : {}),
        ...(writes ? { writes } : {}),
    }

    if (input.truncated || output.truncated) todo.push('The trace was too long to keep in full, so it can\'t be replayed: drop this draft.')
    if (!own && !caught) todo.push('The turn ended without a reply (it failed or was stopped): add the reply the replay should end with, or drop this draft.')
    if (!caught) todo.push('Add what the reply shown must or must not say: expect.shownIncludes / expect.shownExcludes.')
    if (writes) todo.push(`The turn changed today's workout ${writes} time(s): run check-replays and set expect.writes to what it does on the fixture.`)
    for (const e of exercises.filter((x) => !x.fixture)) {
        todo.push(`Exercise ${e.id}${e.library ? ` (${e.library})` : ' (not in the library: the user\'s own)'} isn't in the fixture: replace "${UNMAPPED}${e.id}…" with a fixture exercise as @Name, or drop the step.`)
    }
    for (const e of exercises.filter((x) => x.by === 'attributes')) todo.push(`${e.library} became @${e.fixture}, matched by muscles and equipment: check it fits.`)
    for (const r of routines) todo.push(`The routine "${r}" is the user's own: change it to 推日, 拉日 or 腿日.`)
    if (output.sources?.length) todo.push('The reply cites research: the trace has the renumbered [n] marks, not the note keys Ronnie wrote. Check the reply text.')
    if (input.editFrom != null) todo.push('The user edited an earlier message to send this one.')

    const history = Array.isArray(input.history) ? input.history : []
    const earlier = history.flatMap((m) => {
        const role = (m as { role?: string })?.role
        const text = textOf(m)
        if (!text) return []
        return [`${role === 'user' ? (isEventText(text) ? 'app' : 'user') : 'Ronnie'}: ${cut(asAlex(text), 300)}`]
    })
    const earlierUser = earlier.filter((l) => l.startsWith('user: ')).length
    if (earlierUser) todo.push(`The user sent ${earlierUser} earlier message(s) today. A replay has one message and no history: make \`user\` stand on its own, or drop this draft.`)
    todo.push('Read the user\'s message and the replies for anything personal (names, injuries, weights, dates, places) and rewrite it onto Alex. Then delete `review`.')

    return {
        id: `trace-${day}-${short}`,
        source: `production trace ${short} (${day})`,
        why: '',
        language,
        user: asAlex(String(input.message ?? '')),
        model,
        ...(caught && own ? { retry: own } : {}),
        expect,
        review: {
            todo,
            flags,
            exercises,
            earlier,
            tools: toolCallsOf(messages).map((c) => ({ name: c.name, input: c.input, result: c.result })),
            shown: String(output.reply ?? ''),
        },
    }
}

// ---------- The gate ----------

/** Why a replay can't be committed yet; empty when it can */
export function replayProblems(replay: Record<string, unknown>, file?: string): string[] {
    const problems: string[] = []
    if (file && file !== `${replay.id}.json`) problems.push(`the file name isn't the id ${replay.id}`)
    if (typeof replay.why !== 'string' || !replay.why.trim()) problems.push('no why')
    if ('review' in replay) problems.push('it still has its review notes: finish the review, then delete `review`')
    const steps = Array.isArray(replay.model) ? (replay.model as ReplayStep[]) : []
    const values = steps.flatMap((s) => ('tool' in s ? Object.values(s.input ?? {}).flat() : []))
    if (values.some((v) => typeof v === 'string' && v.startsWith(UNMAPPED))) problems.push('an exercise the fixture doesn\'t have')
    return problems
}
