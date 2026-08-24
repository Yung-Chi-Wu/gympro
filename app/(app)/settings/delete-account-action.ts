'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { success: false, error: 'Not authenticated' }
    }

    const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 先刪除 auth user（會 cascade 清掉所有資料）
    const { error } = await adminClient.auth.admin.deleteUser(user.id)

    if (error) {
        return { success: false, error: error.message }
    }

    // 刪完再登出
    await supabase.auth.signOut()

    return { success: true }
}