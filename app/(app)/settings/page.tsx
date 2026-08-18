import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProfileSettingsForm } from '@/components/ProfileSettingsForm'

export default async function SettingsPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('height_cm, training_goal')
        .eq('user_id', user.id)
        .maybeSingle()

    return (
        <div className="p-8 max-w-lg space-y-6">
            <h1 className="text-2xl font-bold">Profile Settings</h1>
            <ProfileSettingsForm
                userId={user.id}
                initialHeightCm={profile?.height_cm ?? null}
                initialTrainingGoal={profile?.training_goal ?? null}
            />
        </div>
    )
}