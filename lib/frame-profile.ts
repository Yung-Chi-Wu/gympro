import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/** Who is signed in, as the pages need it */
export interface SessionUser {
    id: string
    email: string | null
}

// Who is signed in, once per request, checked on this server: the access token's signature
// against the project's public key (ES256; auth-js keeps the key set 10 minutes), so no call to
// the Auth server. supabase.auth.getUser() asked the Auth server every time, and proxy.ts, the
// layout and each page each did, one after another, on every tab switch. The database checks
// the token the same way, so a page shows nothing the token couldn't read anyway. An expired
// token is refreshed first; proxy.ts has already done that, as only it can save the cookies.
// Server actions and API routes still ask the Auth server (getUser), before they write.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    const claims = data?.claims
    return claims?.sub ? { id: claims.sub, email: claims.email ?? null } : null
})

// Every column a page reads, so the frame and the page share one read of the row
const PROFILE_COLUMNS = 'display_name, height_cm, date_of_birth, sex, training_goal, timezone, language, onboarding_completed, weight_unit, distance_unit'

// The signed-in user and their profile, once per request. The (app) layout, next-intl's request
// config (i18n/request.ts) and the pages all need them; React's cache makes that one check and
// one query, not one of each per caller.
export const getFrameProfile = cache(async () => {
    const user = await getSessionUser()
    if (!user) return { user: null, profile: null }
    const supabase = await createClient()
    const { data: profile } = await supabase
        .from('user_profiles')
        .select(PROFILE_COLUMNS)
        .eq('user_id', user.id)
        .maybeSingle()
    return { user, profile }
})
