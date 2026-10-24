import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database.types'
import { writeTrackingFetch } from '@/lib/data-version'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Every write through this client counts in this browser's data version (lib/data-version.ts)
    { global: { fetch: writeTrackingFetch() } }
  )
}
