import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { ProfileSettingsForm } from '@/components/ProfileSettingsForm'

export default async function SettingsPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const t = await getTranslations('settings')

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('display_name, height_cm, date_of_birth, sex, training_goal, timezone, language, weight_unit, distance_unit')
        .eq('user_id', user.id)
        .maybeSingle()

    const effectiveLanguage = await getEffectiveLanguage(profile?.language)

    return (
        <div className="space-y-5 md:space-y-4">
            <h1 className="text-2xl font-bold max-md:sr-only">{t('title')}</h1>
            <ProfileSettingsForm
                userId={user.id}
                initial={{
                    displayName: profile?.display_name ?? '',
                    heightCm: profile?.height_cm?.toString() ?? '',
                    dateOfBirth: profile?.date_of_birth ?? '',
                    sex: profile?.sex ?? '',
                    timezone: profile?.timezone ?? 'UTC',
                    trainingGoal: profile?.training_goal ?? '',
                    weightUnit: profile?.weight_unit === 'lb' ? 'lb' : 'kg',
                    distanceUnit: profile?.distance_unit === 'mi' ? 'mi' : 'km',
                    language: effectiveLanguage,
                }}
            />
        </div>
    )
}
