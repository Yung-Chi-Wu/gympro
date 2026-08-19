import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WeekSelector } from '@/components/WeekSelector'

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
    searchParams: Promise<{ week?: string }>
}) {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const params = await searchParams
    const availableWeeks = getPastWeeks(13) // last ~3 months
    const selectedWeek = params.week ?? availableWeeks[1] // default to last week, not current

    const weekStartDate = new Date(selectedWeek)
    const weekEndDate = new Date(weekStartDate)
    weekEndDate.setDate(weekEndDate.getDate() + 6)

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
        .gte('performed_at', weekStartDate.toISOString())
        .lte('performed_at', weekEndDate.toISOString())
        .order('performed_at', { ascending: true })

    const { data: recommendation } = await supabase
        .from('ai_recommendations')
        .select('status, recommendation, user_note')
        .eq('user_id', user.id)
        .eq('week_start', selectedWeek)
        .maybeSingle()

    return (
        <div className="p-8 space-y-6 max-w-2xl">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Training History</h1>
                <WeekSelector weeks={availableWeeks} selectedWeek={selectedWeek} />
            </div>

            <WorkoutsByDay workouts={(workouts as WorkoutRow[]) ?? []} />

            {recommendation?.status === 'completed' && recommendation.recommendation && (
                <div className="rounded-lg border p-4 space-y-2">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                        AI Recommendation That Week
                    </h2>
                    <p className="text-sm">
                        {(recommendation.recommendation as { summary: string }).summary}
                    </p>
                    {recommendation.user_note && (
                        <p className="text-sm text-gray-500 italic">
                            Your note: "{recommendation.user_note}"
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}

function WorkoutsByDay({ workouts }: { workouts: WorkoutRow[] }) {
    if (workouts.length === 0) {
        return <p className="text-gray-500">No workouts logged this week.</p>
    }

    return (
        <div className="space-y-4">
            {workouts.map((workout) => (
                <div key={workout.id} className="rounded-lg border p-4">
                    <p className="font-medium mb-2">
                        {new Date(workout.performed_at).toLocaleDateString(undefined, {
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
    // Group individual sets by exercise name, preserving set order.
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

function getPastWeeks(count: number): string[] {
    const now = new Date()
    const day = now.getDay()
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1)
    const thisMonday = new Date(now.setDate(diffToMonday))

    const weeks: string[] = []
    for (let i = 0; i < count; i++) {
        const week = new Date(thisMonday)
        week.setDate(week.getDate() - i * 7)
        weeks.push(week.toISOString().split('T')[0])
    }
    return weeks
}