import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RecommendationPanel } from '@/components/RecommendationPanel'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Welcome back, {user.email}</h1>
      <RecommendationPanel userId={user.id} />
    </div>
  )
}