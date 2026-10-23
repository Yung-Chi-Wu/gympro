import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the session when its access token is about to expire (setAll above saves the new
  // cookies), then checks the token's signature here, with no call to the Auth server
  // (lib/frame-profile.ts getSessionUser)
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims

  const protectedPaths = ['/dashboard', '/metrics', '/settings', '/history', '/routines']
  const isProtected = protectedPaths.some(
    (path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`)
  )

  // Signed out: go to the welcome page, which says what GymPro is and has the log-in
  // button, not straight to the login form. This covers the installed app (it opens
  // /dashboard), bookmarks and shared links.
  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg)$).*)'],
}