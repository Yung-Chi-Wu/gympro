'use server'

import { createClient } from '@/lib/supabase/server'
import { CHOSEN_UTC, isValidTimeZone, UNSET_TIME_ZONE } from '@/lib/time-zone'
import { reportError } from '@/lib/report-error'

/**
 * Gives a profile that never had a time zone (still the column's default) the browser's. A
 * profile with one, chosen or adopted, is left alone, so travelling doesn't move the user's days.
 */
export async function adoptBrowserTimeZone(zone: string): Promise<{ adopted: boolean }> {
    if (!isValidTimeZone(zone) || zone === UNSET_TIME_ZONE || zone === CHOSEN_UTC) return { adopted: false }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { adopted: false }
    // Only while it is unset, checked in the same statement, so it can't overwrite a zone just chosen in Settings
    const { data, error } = await supabase
        .from('user_profiles')
        .update({ timezone: zone })
        .eq('user_id', user.id)
        .or(`timezone.is.null,timezone.eq.${UNSET_TIME_ZONE}`)
        .select('user_id')
    if (error) {
        reportError('time-zone/adopt', error, { userId: user.id })
        return { adopted: false }
    }
    return { adopted: !!data?.length }
}
