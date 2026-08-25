import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { ProfileSettingsForm } from '@/components/ProfileSettingsForm'
import type { WeightUnit } from '@/lib/weight-unit'

export default async function SettingsPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    const t = await getTranslations('settings')

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('display_name, height_cm, date_of_birth, sex, training_goal, timezone, language, weight_unit')
        .eq('user_id', user.id)
        .maybeSingle()

    const effectiveLanguage = await getEffectiveLanguage(profile?.language)

    return (
        <div className="py-8">
            <div className="max-w-lg space-y-6 overflow-x-hidden">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <ProfileSettingsForm
                    userId={user.id}
                    initialHeightCm={profile?.height_cm ?? null}
                    initialDisplayName={profile?.display_name ?? null}
                    initialTrainingGoal={profile?.training_goal ?? null}
                    initialDateOfBirth={profile?.date_of_birth ?? null}
                    initialSex={profile?.sex ?? null}
                    initialTimezone={profile?.timezone ?? 'UTC'}
                    initialLanguage={effectiveLanguage}
                    initialWeightUnit={(profile?.weight_unit as WeightUnit) ?? 'kg'}
                />
            </div>
        </div>
    )
}