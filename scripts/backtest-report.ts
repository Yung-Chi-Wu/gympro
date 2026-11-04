import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSecret } from '../lambda/ai-worker/src/secrets'
import { fetchReportInputs } from '../lambda/ai-worker/src/report/fetch'
import { addUp, replay, score, summarize, summaryLines, type PastWeek, type Summary } from '../lambda/ai-worker/evals/backtest/backtest'
import { addDays, lastCompletedPeriod, localDate, weekOf } from '../lib/periods'
import { timeZoneOf } from '../lib/time-zone'

// The weekly report's backtest on real accounts (lambda/ai-worker/evals/backtest/backtest.ts):
// every week each account logged, read as the report read it then, and checked against what the
// account did after. No model is called, so it costs nothing. Run by hand:
//   AWS_PROFILE=gympro-terraform npm run backtest:report -- --all
//   AWS_PROFILE=gympro-terraform npm run backtest:report -- --email <the account's login email>
// --all reads every account but the demo one, and keeps only counts added up over them: nothing
// of any one account is printed or written (owner, 2026-11-04). --email reads that account alone,
// and also writes each outcome, with the exercise's name, to look at the misses. Both write to
// lambda/ai-worker/evals/backtest/results/, which git ignores. The service-role key comes from
// SSM, the same one the Lambda uses, and is never printed. SUPABASE_URL comes from the
// environment or from infra/terraform/terraform.tfvars.

const RESULTS = 'lambda/ai-worker/evals/backtest/results'
/** The demo account's made-up history (supabase/seed/demo_account.sql) is no one's real training */
const DEMO_EMAIL = 'demo@example.com'

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

/** Every account's login email, by user id */
async function emails(supabase: SupabaseClient): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (let page = 1; ; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        for (const u of data.users) out.set(u.id, (u.email ?? '').toLowerCase())
        if (data.users.length < 200) return out
    }
}

/** Every week from the account's first workout to the last one that has ended, as the report would have read each */
async function pastWeeks(supabase: SupabaseClient, userId: string, timeZone: string): Promise<PastWeek[]> {
    const { data, error } = await supabase.from('workouts').select('performed_at').eq('user_id', userId).order('performed_at').limit(1)
    if (error) throw new Error(`Failed to read the first workout: ${error.message}`)
    const first = data?.[0]?.performed_at
    if (!first) return []
    const last = lastCompletedPeriod(timeZone).periodStart
    const weeks: PastWeek[] = []
    for (let start = weekOf(localDate(timeZone, new Date(first))).periodStart; start <= last; start = addDays(start, 7)) {
        const { inputs, library, previousGoal } = await fetchReportInputs(supabase, userId, start, addDays(start, 6))
        // As the report handler sets them before its decisions (index.ts), the goal from the read kept with it
        weeks.push({ inputs: { ...inputs, library }, goalRead: previousGoal })
    }
    return weeks
}

async function main() {
    const email = option('email')?.trim().toLowerCase()
    const all = process.argv.includes('--all')
    if (!email === !all) {
        console.error('usage: AWS_PROFILE=gympro-terraform npm run backtest:report -- --all | --email <login email>')
        process.exit(2)
    }

    const key = await getSecret(process.env.SUPABASE_SERVICE_ROLE_KEY_PARAM ?? '/gympro/supabase-service-role-key')
    const supabase = createClient(supabaseUrl(), key, { auth: { persistSession: false } })
    const byId = await emails(supabase)

    const { data: profiles, error } = await supabase.from('user_profiles').select('user_id, timezone')
    if (error) throw error
    const accounts = (profiles ?? []).filter((p) => (email ? byId.get(p.user_id) === email : byId.get(p.user_id) !== DEMO_EMAIL))
    if (!accounts.length) {
        console.error(email ? 'No account has that email.' : 'No accounts.')
        process.exit(1)
    }

    console.log(`Replaying ${accounts.length} account(s)...`)
    const summaries: Summary[] = []
    let failed = 0
    let detail: unknown = null
    for (const p of accounts) {
        try {
            const weeks = replay(await pastWeeks(supabase, p.user_id, timeZoneOf(p.timezone)))
            if (!weeks.length) continue
            const outcomes = score(weeks)
            summaries.push(summarize(weeks, outcomes))
            if (email) {
                // One account, the one asked for: each outcome with its exercise's name
                const names = new Map(weeks.flatMap((w) => w.facts.lifts.map((l) => [l.exerciseId, l.name] as const)))
                const named = <T extends { exerciseId: string }>(list: T[]) => list.map((x) => ({ ...x, exercise: names.get(x.exerciseId) ?? x.exerciseId }))
                detail = { plans: named(outcomes.plans), regressions: named(outcomes.regressions), drops: named(outcomes.drops), stalls: named(outcomes.stalls) }
            }
        } catch (err) {
            // Said without the account: an --all run names none
            failed++
            console.error(`An account could not be replayed: ${err instanceof Error ? err.message : err}`)
        }
    }

    const total = addUp(summaries)
    console.log('')
    for (const line of summaryLines(total)) console.log(line)
    if (failed) console.log(`\n${failed} account(s) failed and are left out.`)

    mkdirSync(RESULTS, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const name = `${day}-${all ? 'all' : 'one'}`
    writeFileSync(join(RESULTS, `${name}.json`), `${JSON.stringify(total, null, 2)}\n`)
    if (detail) writeFileSync(join(RESULTS, `${name}-detail.json`), `${JSON.stringify(detail, null, 2)}\n`)
    console.log(`\nWritten to ${RESULTS}/${name}.json${detail ? ` and ${name}-detail.json` : ''}`)
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
})
