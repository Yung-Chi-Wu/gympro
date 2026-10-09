import { createClient } from '@supabase/supabase-js'

// The service-role client, for server code only: it bypasses row level security. Used for
// writes no user may make themselves, such as AI traces. Null when the key isn't configured.
export function createAdminClient() {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!key) return null
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
