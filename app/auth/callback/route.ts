import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { reportError } from '@/lib/report-error'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? '/dashboard'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
        // Kept for a look without alarming: an expired or reused link is the user's, not a bug
        reportError('auth/callback', error, { level: 'warning', context: { route: 'auth/callback' } })
    }

    return NextResponse.redirect(`${origin}/login?error=oauth_failed`)
}