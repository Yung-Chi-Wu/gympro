'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/report-error'

export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'Not authenticated' }
        }

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            reportError('account/delete', 'SUPABASE_SERVICE_ROLE_KEY is not set', { userId: user.id })
            return { success: false, error: 'Server configuration error: missing service role key' }
        }

        const adminClient = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        )

        const { error } = await adminClient.auth.admin.deleteUser(user.id)

        if (error) {
            reportError('account/delete', error, { userId: user.id })
            return { success: false, error: error.message }
        }

        await supabase.auth.signOut()
        return { success: true }

    } catch (err) {
        reportError('account/delete', err)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
}