#!/usr/bin/env node
// Paid check of the daily review's reviewer (src/audit/auditor.ts) on Ronnie eval conversations
// whose outcome is known: the eval's judge failed or passed each one against its case's rubric.
// The reviewer gets no rubric, as in production; it should flag the replies the judge failed and
// leave the ones it passed. Each failed conversation is paired with a passed one of the same case.
// Reads the local eval traces (.claude/hillclimb/ronnie/<variant>/traces, kept out of the repo
// since v29) and makes one call per conversation, about US$0.05 each; --dry-run makes none.
//   AWS_PROFILE=<profile> ANTHROPIC_API_KEY_PARAM=/gympro/anthropic-api-key node lambda/ai-worker/evals/audit/check-live.mjs [--dry-run] [--max N] [--holdout N] [--variants v29,v30,v31,v32,v33]
// --holdout N reads N passed conversations of other cases instead, one per case, for false alarms
// on conversations the prompt wasn't written against.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const worker = join(here, '..', '..')
const repo = join(worker, '..', '..')
execFileSync(join(worker, 'node_modules/.bin/esbuild'), ['evals/audit/entry.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=evals/audit/dist/audit.cjs', '--log-level=warning'], { cwd: worker, stdio: 'inherit' })
const a = createRequire(import.meta.url)(join(here, 'dist', 'audit.cjs'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const max = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity
const holdout = args.includes('--holdout') ? Number(args[args.indexOf('--holdout') + 1]) : 0
const variants = (args[args.indexOf('--variants') + 1] && args.includes('--variants') ? args[args.indexOf('--variants') + 1] : 'v29,v30,v31,v32,v33').split(',')
const flow = join(repo, '.claude', 'hillclimb', 'ronnie')

/** Every graded rep with a trace on disk: its case, whether the judge passed it, and why */
const reps = variants.flatMap((v) => {
    const results = join(flow, v, 'results.jsonl')
    if (!existsSync(results)) return []
    return readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).flatMap((r) => {
        const path = join(flow, v, 'traces', `${r.prompt_id}_rep${r.rep}.json`)
        if (!existsSync(path) || r.grade?.judge_ok == null) return []
        return [{ variant: v, id: r.prompt_id, rep: r.rep, path, passed: r.grade.pass === 1, why: r.explanation?.judge_ok ?? '' }]
    })
})
// Each failed rep, with a passed rep of the same case (the same variant first), each used once
const failedReps = reps.filter((r) => !r.passed)
const used = new Set()
const pairs = failedReps.flatMap((f) => {
    const pass = [...reps.filter((r) => r.passed && r.id === f.id && r.variant === f.variant), ...reps.filter((r) => r.passed && r.id === f.id)]
        .find((r) => !used.has(r.path))
    if (!pass) return [f]
    used.add(pass.path)
    return [f, pass]
})

/** An eval trace ([app_event...] user, tool_call..., assistant, per turn) as the review's day */
function conversationOf(rep) {
    const trace = JSON.parse(readFileSync(rep.path, 'utf8'))
    const language = rep.id.endsWith('-zh') ? 'zh-TW' : 'en'
    const at = a.FIXTURE_NOW.toISOString()
    const turns = []
    let events = []
    for (const m of trace) {
        if (m.role === 'app_event') events.push(m.content)
        else if (m.role === 'user') {
            const tapped = events.map((e) => `(Before this, the user tapped a button in the app: ${e})\n`).join('')
            turns.push({ traceId: `${rep.variant}/${rep.id}_rep${rep.rep}#${turns.length + 1}`, at, user: `${tapped}${m.content}`, event: false, newConversation: turns.length === 0, edited: false, toolCalls: [], reply: '', own: '', appLines: [] })
            events = []
        } else if (m.role === 'tool_call' && turns.length) {
            const { input, result } = JSON.parse(m.content)
            turns.at(-1).toolCalls.push({ name: m.name, input, result: String(result) })
        } else if (m.role === 'assistant' && turns.length) {
            // An eval trace keeps only the reply shown; the app's lines are the paragraphs it starts with its marks
            const paragraphs = String(m.content).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
            const appLines = paragraphs.filter((p) => /^(📝|📌|📋)/u.test(p))
            Object.assign(turns.at(-1), { reply: m.content, appLines, own: paragraphs.filter((p) => !appLines.includes(p)).join('\n\n') })
        }
    }
    return {
        userId: 'eval-fixture-user', day: new Date(at).toLocaleDateString('en-CA', { timeZone: a.FIXTURE_TIME_ZONE }), timeZone: a.FIXTURE_TIME_ZONE, language,
        system: a.buildSystemPrompt(language, { ...a.FIXTURE_USER, notes: a.fixtureNotes([], language) }),
        turns: turns.filter((t) => t.reply),
        traceIds: turns.map((t) => t.traceId),
    }
}

// One passed rep of each case that never failed, the latest variant first
const failedCases = new Set(failedReps.map((r) => r.id))
const holdoutReps = [...new Map([...reps].reverse().filter((r) => r.passed && !failedCases.has(r.id)).map((r) => [r.id, r])).values()].slice(0, holdout)
const items = (holdout ? holdoutReps : pairs).slice(0, max).map((rep) => ({ rep, conversation: conversationOf(rep) }))
console.log(`${items.length} conversations: ${items.filter((i) => !i.rep.passed).length} the judge failed, ${items.filter((i) => i.rep.passed).length} it passed (${variants.join(', ')})`)
if (dryRun) {
    const chars = items.reduce((n, i) => n + i.conversation.system.length + JSON.stringify(i.conversation.turns).length, 0)
    console.log(`about ${chars} characters of conversation in all; no calls made`)
    process.exit(0)
}

const client = await a.getClaudeClient()
let cost = 0
const outcomes = []
// Four at a time
for (let i = 0; i < items.length; i += 4) {
    outcomes.push(...await Promise.all(items.slice(i, i + 4).map(async ({ rep, conversation }) => {
        try {
            const review = await a.reviewConversation(client, conversation)
            cost += a.costOf(review.model, [review.usage]) ?? 0
            return { rep, problems: review.problems, model: review.model }
        } catch (err) {
            if (err.usage) cost += a.costOf(a.AUDIT_MODEL, [err.usage]) ?? 0
            return { rep, error: err.message }
        }
    })))
}

for (const o of outcomes) {
    const flagged = o.problems?.length > 0
    const agrees = o.error ? '??' : flagged === !o.rep.passed ? 'ok' : '--'
    console.log(`${agrees} judge ${o.rep.passed ? 'pass' : 'FAIL'} | review ${o.error ? `error: ${o.error}` : flagged ? o.problems.map((p) => `${p.kind}: ${p.summary}`).join(' / ') : 'nothing found'} | ${o.rep.variant}/${o.rep.id} rep ${o.rep.rep}`)
    if (!o.rep.passed) console.log(`     judge: ${o.rep.why}`)
}
const answered = outcomes.filter((o) => !o.error)
const caught = answered.filter((o) => !o.rep.passed && o.problems.length).length
const falseAlarms = answered.filter((o) => o.rep.passed && o.problems.length).length
console.log(`\ncaught ${caught}/${answered.filter((o) => !o.rep.passed).length} the judge failed; flagged ${falseAlarms}/${answered.filter((o) => o.rep.passed).length} it passed; ${outcomes.length - answered.length} errors; US$${cost.toFixed(2)}`)
