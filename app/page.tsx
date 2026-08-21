import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold uppercase tracking-wide">GymPro</h1>
      <p className="max-w-sm text-ink/60">
        Track your training, follow your routines, and get AI-powered
        feedback every period — built for lifters who want to see real
        progress.
      </p>
      <div className="flex w-full max-w-xs flex-col gap-3">

        <a href="/login"
          className="rounded-md bg-plate px-4 py-3 text-center font-display uppercase tracking-wide text-chalk hover:bg-plate-light"
        >
          Log In
        </a>

        <a href="/signup"
          className="rounded-md border px-4 py-3 text-center text-sm"
        >
          Create an Account
        </a>
      </div>
    </div>
  )
}