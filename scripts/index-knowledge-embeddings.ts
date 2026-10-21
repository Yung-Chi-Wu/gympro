import { readFileSync } from 'node:fs'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { createClient } from '@supabase/supabase-js'
import { embed, SEARCH_EMBEDDING_MODEL } from '../lib/embeddings'
import { KNOWLEDGE_NOTES, knowledgeDocument } from '../lib/ronnie/knowledge'
import { getSecret } from '../lambda/ai-worker/src/secrets'
import type { Database } from '../lib/types/database.types'

// Writes each knowledge note's search vector, which match_knowledge reads
// (supabase/migrations/20261022120000_knowledge_notes.sql). Run it by hand after the notes change:
//   AWS_PROFILE=gympro-terraform npm run index:knowledge -- [--dry-run]
// Only notes whose text (knowledgeDocument) changed since the last run are embedded, so a rerun
// with nothing changed makes no Bedrock calls; rows for notes no longer in the file are removed.
// The service-role key comes from SSM, the same one the Lambda uses, and is never printed.
// SUPABASE_URL comes from the environment or from infra/terraform/terraform.tfvars.

function supabaseUrl(): string {
    if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL
    const match = readFileSync('infra/terraform/terraform.tfvars', 'utf8').match(/^\s*supabase_url\s*=\s*"([^"]+)"/m)
    if (!match) throw new Error('Set SUPABASE_URL')
    return match[1]
}

async function main() {
    const dryRun = process.argv.includes('--dry-run')
    const key = await getSecret(process.env.SUPABASE_SERVICE_ROLE_KEY_PARAM ?? '/gympro/supabase-service-role-key')
    const supabase = createClient<Database>(supabaseUrl(), key, { auth: { persistSession: false } })

    const { data, error } = await supabase.from('knowledge_notes').select('id, embedding_text')
    if (error) throw error
    const stored = new Map(data.map((r) => [r.id, r.embedding_text]))
    const stale = KNOWLEDGE_NOTES.map((n) => ({ id: n.id, text: knowledgeDocument(n) })).filter(({ id, text }) => stored.get(id) !== text)
    const ids = new Set(KNOWLEDGE_NOTES.map((n) => n.id))
    const gone = data.filter((r) => !ids.has(r.id)).map((r) => r.id)
    console.log(`${KNOWLEDGE_NOTES.length} notes: ${stale.length} to embed, ${KNOWLEDGE_NOTES.length - stale.length} up to date, ${gone.length} to remove`)
    if (dryRun) return

    if (stale.length) {
        const vectors = await embed(new BedrockRuntimeClient({ region: 'us-east-1' }), SEARCH_EMBEDDING_MODEL, stale.map((s) => s.text), 'document')
        const rows = stale.map((s, i) => ({ id: s.id, embedding: JSON.stringify(vectors[i]), embedding_text: s.text, updated_at: new Date().toISOString() }))
        const { error: upsertError } = await supabase.from('knowledge_notes').upsert(rows)
        if (upsertError) throw upsertError
        console.log(`Embedded ${stale.length} with ${SEARCH_EMBEDDING_MODEL}`)
    }
    if (gone.length) {
        const { error: deleteError } = await supabase.from('knowledge_notes').delete().in('id', gone)
        if (deleteError) throw deleteError
        console.log(`Removed ${gone.length}`)
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
