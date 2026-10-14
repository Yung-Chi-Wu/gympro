import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

// The signed-in user and the profile fields the app's frame needs, once per request. The
// (app) layout and next-intl's request config (i18n/request.ts) both need them; React's
// cache makes that one auth call and one query, not two of each.
export const getFrameProfile = cache(async () => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { user: null, profile: null }
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('language, onboarding_completed, timezone')
        .eq('user_id', user.id)
        .maybeSingle()
    return { user, profile }
})
