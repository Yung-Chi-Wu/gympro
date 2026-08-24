'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'

export async function deleteAccount(): Promise<{ error: string } | never> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // 用 service role 刪除 auth user（會 cascade 刪掉所有資料）
    const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error } = await adminClient.auth.admin.deleteUser(user.id)

    if (error) {
        return { error: error.message }
    }

    // 登出
    await supabase.auth.signOut()
    redirect('/login')
}