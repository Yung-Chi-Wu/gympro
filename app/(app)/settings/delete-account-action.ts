'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'Not authenticated' }
        }

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return { success: false, error: 'Server configuration error: missing service role key' }
        }

        const adminClient = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        )

        const { error } = await adminClient.auth.admin.deleteUser(user.id)

        if (error) {
            return { success: false, error: error.message }
        }

        await supabase.auth.signOut()
        return { success: true }

    } catch (err) {
        console.error('deleteAccount error:', err)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
}