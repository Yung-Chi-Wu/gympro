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
        .select('display_name, height_cm, date_of_birth, sex, training_goal')
        .eq('user_id', user.id)
        .maybeSingle()

    return (
        <div className="p-8 max-w-lg space-y-6">
            <h1 className="text-2xl font-bold">Profile Settings</h1>
            <ProfileSettingsForm
                userId={user.id}
                initialDisplayName={profile?.display_name ?? null}
                initialHeightCm={profile?.height_cm ?? null}
                initialDateOfBirth={profile?.date_of_birth ?? null}
                initialSex={profile?.sex ?? null}
                initialTrainingGoal={profile?.training_goal ?? null}
            />
        </div>
    )
}