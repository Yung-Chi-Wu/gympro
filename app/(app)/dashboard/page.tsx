import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RecommendationPanel } from '@/components/RecommendationPanel'
import { ReminderBanner } from '@/components/ReminderBanner'

const WEIGHT_REMINDER_DAYS = 7
const HEIGHT_REMINDER_DAYS = 30

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, height_updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: latestMetric } = await supabase
    .from('body_metrics')
    .select('recorded_at')
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const needsWeightLog = isOlderThanDays(latestMetric?.recorded_at ?? null, WEIGHT_REMINDER_DAYS)
  const needsHeightConfirm = isOlderThanDays(profile?.height_updated_at ?? null, HEIGHT_REMINDER_DAYS)
  const greetingName = profile?.display_name || user.email

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold uppercase tracking-wide">Welcome back, {greetingName}</h1>
      <a href="/history" className="text-sm underline">View training history</a>
      <ReminderBanner
        userId={user.id}
        needsWeightLog={needsWeightLog}
        needsHeightConfirm={needsHeightConfirm}
      />
      <RecommendationPanel userId={user.id} />
    </div>
  )
}

function isOlderThanDays(dateString: string | null, days: number): boolean {
  if (!dateString) return true
  const recorded = new Date(dateString).getTime()
  const now = Date.now()
  const diffDays = (now - recorded) / (1000 * 60 * 60 * 24)
  return diffDays >= days
}