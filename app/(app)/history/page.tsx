import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PeriodSelector, type PeriodOption } from '@/components/PeriodSelector'

interface WorkoutSetRow {
    id: string
    set_number: number
    reps: number
    weight_kg: number
    is_warmup: boolean
    exercises: { name: string; muscle_group: string } | null
}

interface WorkoutRow {
    id: string
    title: string | null
    performed_at: string
    workout_sets: WorkoutSetRow[]
}

export default async function HistoryPage({
    searchParams,
}: {
    searchParams: Promise<{ period?: string }>
}) {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const { data: cycle } = await supabase
        .from('training_cycles')
        .select('cycle_length, start_date')
        .eq('user_id', user.id)
        .maybeSingle()

    const availablePeriods = cycle
        ? computeCyclePeriods(cycle.start_date, cycle.cycle_length, 13)
        : computeCalendarWeekPeriods(13)

    const params = await searchParams
    const selectedPeriodStart =
        params.period ?? (await pickDefaultPeriodStart(supabase, user.id, availablePeriods))

    const selectedPeriod =
        availablePeriods.find((p) => p.start === selectedPeriodStart) ?? availablePeriods[0]

    const periodStartDate = new Date(selectedPeriod.start)
    const periodEndDate = new Date(selectedPeriod.end)

    const { data: workouts } = await supabase
        .from('workouts')
        .select(
            `
      id, title, performed_at,
      workout_sets (
        id, set_number, reps, weight_kg, is_warmup,
        exercises ( name, muscle_group )
      )
    `
        )
        .eq('user_id', user.id)
        .gte('performed_at', periodStartDate.toISOString())
        .lte('performed_at', periodEndDate.toISOString())
        .order('performed_at', { ascending: true })

    return (
        <div className="p-8 space-y-6 max-w-2xl">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Training History</h1>
                <PeriodSelector periods={availablePeriods} selectedPeriodStart={selectedPeriod.start} />
            </div>

            <WorkoutsByDay workouts={(workouts as WorkoutRow[]) ?? []} />
        </div>
    )
}

function WorkoutsByDay({ workouts }: { workouts: WorkoutRow[] }) {
    if (workouts.length === 0) {
        return <p className="text-gray-500">No workouts logged this period.</p>
    }

    return (
        <div className="space-y-4">
            {workouts.map((workout) => (
                <div key={workout.id} className="rounded-lg border p-4">
                    <p className="font-medium mb-2">
                        {new Date(workout.performed_at).toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'short',
                            day: 'numeric',
                        })}
                        {workout.title && ` — ${workout.title}`}
                    </p>
                    <ExercisesInWorkout sets={workout.workout_sets} />
                </div>
            ))}
        </div>
    )
}

function ExercisesInWorkout({ sets }: { sets: WorkoutSetRow[] }) {
    const byExercise = new Map<string, WorkoutSetRow[]>()
    for (const set of sets) {
        const name = set.exercises?.name ?? 'Unknown exercise'
        if (!byExercise.has(name)) byExercise.set(name, [])
        byExercise.get(name)!.push(set)
    }

    return (
        <div className="space-y-2">
            {Array.from(byExercise.entries()).map(([exerciseName, exerciseSets]) => (
                <div key={exerciseName} className="text-sm">
                    <span className="font-medium">{exerciseName}</span>
                    {': '}
                    {exerciseSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map((s) => `${s.weight_kg}kg×${s.reps}`)
                        .join(', ')}
                </div>
            ))}
        </div>
    )
}

// ---------- Period computation: calendar weeks for regular users, ----------
// ---------- the user's own cycle length for Pro users. ----------

function computeCalendarWeekPeriods(count: number): PeriodOption[] {
    const now = new Date()
    const day = now.getDay()
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1)
    const thisMonday = new Date(now.setDate(diffToMonday))

    const periods: PeriodOption[] = []
    for (let i = 0; i < count; i++) {
        const start = new Date(thisMonday)
        start.setDate(start.getDate() - i * 7)
        const end = new Date(start)
        end.setDate(end.getDate() + 6)
        periods.push({
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
        })
    }
    return periods
}

function computeCyclePeriods(
    startDate: string,
    cycleLength: number,
    count: number
): PeriodOption[] {
    const start = new Date(`${startDate}T00:00:00Z`)
    const today = new Date()
    const daysSinceStart = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
    const currentIndex = Math.max(0, Math.floor(daysSinceStart / cycleLength))

    const periods: PeriodOption[] = []
    for (let i = 0; i < count && currentIndex - i >= 0; i++) {
        const index = currentIndex - i
        const periodStart = addDays(startDate, index * cycleLength)
        const periodEnd = addDays(periodStart, cycleLength - 1)
        periods.push({ start: periodStart, end: periodEnd })
    }
    return periods
}

function addDays(dateIso: string, days: number): string {
    const date = new Date(`${dateIso}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().split('T')[0]
}

// ---------- Default selection: current period if it has data, otherwise the previous one ----------

async function pickDefaultPeriodStart(
    supabase: Awaited<ReturnType<typeof createClient>>,
    userId: string,
    periods: PeriodOption[]
): Promise<string> {
    const current = periods[0]
    if (!current) {
        // Shouldn't happen, but guards against an empty periods array.
        return new Date().toISOString().split('T')[0]
    }

    const { count } = await supabase
        .from('workouts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('performed_at', new Date(current.start).toISOString())
        .lte('performed_at', new Date(current.end).toISOString())

    return count && count > 0 ? current.start : (periods[1]?.start ?? current.start)
}