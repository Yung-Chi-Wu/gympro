import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { getSecret } from '../lambda/ai-worker/src/secrets'
import { traceToDraft, type ProductionTrace, type TraceFlag } from '../evals/ronnie/trace-draft'

// Drafts a replay (evals/ronnie/replays) from each flagged Ronnie conversation of one account, for
// a person to review before it's committed (the repo is public). Run by hand:
//   AWS_PROFILE=gympro-terraform npm run trace:to-case -- --email <the account's login email> [--days 30] [--force]
// Only that account's traces are read: other users' conversations stay in the database. A draft is
// written to evals/ronnie/drafts/<id>.json, which git ignores, and one already there is kept unless
// --force. Nothing from a conversation is printed here; open the drafts to read them. Then, for
// each draft worth keeping: do its review.todo, delete `review`, save it as
// evals/ronnie/replays/<id>.json and run `node evals/ronnie/check-replays.mjs`, which refuses one
// that isn't finished. The service-role key comes from SSM, the same one the Lambda uses, and is
// never printed. SUPABASE_URL comes from the environment or from infra/terraform/terraform.tfvars.

const DRAFTS = 'evals/ronnie/drafts'

function supabaseUrl(): string {
    if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL
    const match = readFileSync('infra/terraform/terraform.tfvars', 'utf8').match(/^\s*supabase_url\s*=\s*"([^"]+)"/m)
    if (!match) throw new Error('Set SUPABASE_URL')
    return match[1]
}

function option(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
    const email = option('email')?.trim().toLowerCase()
    const days = Number(option('days') ?? 30)
    const force = process.argv.includes('--force')
    if (!email || !(days > 0)) {
        console.error('usage: AWS_PROFILE=gympro-terraform npm run trace:to-case -- --email <login email> [--days 30] [--force]')
        process.exit(2)
    }

    const key = await getSecret(process.env.SUPABASE_SERVICE_ROLE_KEY_PARAM ?? '/gympro/supabase-service-role-key')
    const supabase = createClient(supabaseUrl(), key, { auth: { persistSession: false } })

    // The account, by its login email
    let userId: string | null = null
    for (let page = 1; !userId; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null
        if (data.users.length < 200) break
    }
    if (!userId) {
        console.error('No account has that email.')
        process.exit(1)
    }

    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const { data: traces, error } = await supabase
        .from('ai_traces')
        .select('id, created_at, status, input, output')
        .eq('user_id', userId)
        .eq('feature', 'ronnie')
        .not('flagged_at', 'is', null)
        .gte('created_at', since)
        .order('created_at')
    if (error) throw error
    const rows = (traces ?? []) as ProductionTrace[]
    const { data: flagRows, error: flagError } = rows.length
        ? await supabase.from('ai_trace_flags').select('trace_id, kind, detail').in('trace_id', rows.map((t) => t.id)).order('created_at')
        : { data: [], error: null }
    if (flagError) throw flagError

    mkdirSync(DRAFTS, { recursive: true })
    console.log(`${rows.length} flagged conversation turn(s) in the last ${days} days`)
    for (const trace of rows) {
        const flags: TraceFlag[] = (flagRows ?? []).filter((f) => f.trace_id === trace.id).map((f) => ({ kind: f.kind, detail: f.detail }))
        const draft = traceToDraft(trace, flags)
        const file = join(DRAFTS, `${draft.id}.json`)
        const kept = existsSync(file) && !force
        if (!kept) writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`)
        console.log(`${kept ? 'kept   ' : 'drafted'} ${file}  flags: ${flags.map((f) => f.kind).join(', ')}  to do: ${draft.review.todo.length}`)
    }
    if (rows.length) console.log(`\nOpen each draft, do its review.todo, delete \`review\`, save it as evals/ronnie/replays/<id>.json, then run node evals/ronnie/check-replays.mjs.`)
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
