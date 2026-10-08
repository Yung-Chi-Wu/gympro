import { readFileSync } from 'node:fs'
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { createClient } from '@supabase/supabase-js'
import { embed, SEARCH_EMBEDDING_MODEL } from '../lib/embeddings'
import { exerciseDocument } from '../lib/ronnie/search'
import { getSecret } from '../lambda/ai-worker/src/secrets'
import type { Database } from '../lib/types/database.types'

// Writes each exercise's search vector, which match_exercises reads
// (supabase/migrations/20261008130000_exercise_vector_search.sql). Run it by hand after
// the library changes:
//   AWS_PROFILE=gympro-terraform npm run index:exercises -- [--dry-run]
// Only exercises whose text (exerciseDocument) changed since the last run are embedded,
// so a rerun with nothing changed makes no Bedrock calls. The service-role key comes from
// SSM, the same one the Lambda uses, and is never printed. SUPABASE_URL comes from the
// environment or from infra/terraform/terraform.tfvars.

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

    const { data, error } = await supabase.from('exercises').select('id, name, name_zh_tw, muscle_group, equipment, embedding_text')
    if (error) throw error
    const stale = data.map((e) => ({ e, text: exerciseDocument(e) })).filter(({ e, text }) => e.embedding_text !== text)
    console.log(`${data.length} exercises: ${stale.length} to embed, ${data.length - stale.length} up to date`)
    if (dryRun || !stale.length) return

    const vectors = await embed(new BedrockRuntimeClient({ region: 'us-east-1' }), SEARCH_EMBEDDING_MODEL, stale.map((s) => s.text), 'document')
    for (const [i, { e, text }] of stale.entries()) {
        const { error: updateError } = await supabase.from('exercises').update({ embedding: JSON.stringify(vectors[i]), embedding_text: text }).eq('id', e.id)
        if (updateError) throw new Error(`${e.name}: ${updateError.message}`)
    }
    console.log(`Embedded ${stale.length} with ${SEARCH_EMBEDDING_MODEL}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
