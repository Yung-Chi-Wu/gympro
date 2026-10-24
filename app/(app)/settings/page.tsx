import { redirect } from 'next/navigation'
import { getFrameProfile, getSessionUser } from '@/lib/frame-profile'
import { getTranslations } from 'next-intl/server'
import { getEffectiveLanguage } from '@/lib/get-language'
import { ProfileSettingsForm } from '@/components/ProfileSettingsForm'
import { CHOSEN_UTC, timeZoneOf, UNSET_TIME_ZONE } from '@/lib/time-zone'
import { ServerTimingMark } from '@/components/ServerTimingMark'
import { ReadYourWrites } from '@/components/ReadYourWrites'

export default async function SettingsPage() {
    const user = await getSessionUser()
    if (!user) redirect('/login')

    // The profile is the one the frame read (lib/frame-profile.ts)
    const [{ profile }, t] = await Promise.all([getFrameProfile(), getTranslations('settings')])

    const effectiveLanguage = await getEffectiveLanguage(profile)

    return (
        <div className="space-y-5 md:space-y-4">
            <ServerTimingMark />
            <ReadYourWrites />
            <h1 className="text-2xl font-bold max-md:sr-only">{t('title')}</h1>
            <ProfileSettingsForm
                userId={user.id}
                initial={{
                    displayName: profile?.display_name ?? '',
                    heightCm: profile?.height_cm?.toString() ?? '',
                    dateOfBirth: profile?.date_of_birth ?? '',
                    sex: profile?.sex ?? '',
                    // An unset zone shows as UTC, the same option a choice of UTC saves as
                    timezone: timeZoneOf(profile?.timezone) === UNSET_TIME_ZONE ? CHOSEN_UTC : timeZoneOf(profile?.timezone),
                    trainingGoal: profile?.training_goal ?? '',
                    weightUnit: profile?.weight_unit === 'lb' ? 'lb' : 'kg',
                    distanceUnit: profile?.distance_unit === 'mi' ? 'mi' : 'km',
                    language: effectiveLanguage,
                }}
            />
        </div>
    )
}
