import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WeightTrendSection } from '@/components/WeightTrendSection'

interface BodyMetricRow {
    id: string
    recorded_at: string
    weight_kg: number | null
}

export default async function MetricsPage() {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const { data: bodyMetrics } = await supabase
        .from('body_metrics')
        .select('id, recorded_at, weight_kg')
        .eq('user_id', user.id)
        .order('recorded_at', { ascending: true })

    return (
        <div className="p-8 max-w-2xl space-y-10">
            <h1 className="text-3xl font-bold uppercase tracking-wide">Body Metrics</h1>

            <WeightTrendSection
                userId={user.id}
                entries={((bodyMetrics as BodyMetricRow[]) ?? []).map((m) => ({
                    id: m.id,
                    recordedAt: m.recorded_at,
                    weightKg: m.weight_kg,
                }))}
            />

            <p className="text-sm text-ink/60">
                Strength trends and workout-split breakdowns now live in your period
                reports — check back once that page is built.
            </p>
        </div>
    )
}