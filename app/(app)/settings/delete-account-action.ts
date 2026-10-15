'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportError } from '@/lib/report-error'

// The browser gets a fixed code, never the error's own text: reportError keeps that
export async function deleteAccount(): Promise<{ success: boolean; error?: 'not_signed_in' | 'delete_failed' }> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'not_signed_in' }
        }

        const adminClient = createAdminClient()
        if (!adminClient) {
            reportError('account/delete', 'SUPABASE_SERVICE_ROLE_KEY is not set', { userId: user.id })
            return { success: false, error: 'delete_failed' }
        }

        const { error } = await adminClient.auth.admin.deleteUser(user.id)

        if (error) {
            reportError('account/delete', error, { userId: user.id })
            return { success: false, error: 'delete_failed' }
        }

        await supabase.auth.signOut()
        return { success: true }

    } catch (err) {
        reportError('account/delete', err)
        return { success: false, error: 'delete_failed' }
    }
}
