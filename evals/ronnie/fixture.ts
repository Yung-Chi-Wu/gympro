import { createHash } from 'node:crypto'
import type { PlannedExercise, RonnieData, RoutineProposal } from '../../lib/ronnie/data'
import { dateGuide, localDateStr } from '../../lib/ronnie/time'

// One fictional user for the Ronnie eval. "Today" is Wednesday 2026-10-07 in
// Taipei, day 1 (push) of a push/pull/legs cycle, with bench press already
// logged. Every write Ronnie makes is recorded and applied in memory, so a
// later turn sees the change and the grader can inspect it.

export const FIXTURE_TIME_ZONE = 'Asia/Taipei'
export const FIXTURE_NOW = new Date('2026-10-07T02:00:00Z') // 10:00 in Taipei

// UUID-shaped ids, so an invented id can't accidentally look right
const idFor = (name: string) => {
    const h = createHash('md5').update(name).digest('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const EXERCISE_LIST: [string, string, string][] = [
    ['Barbell Bench Press', '槓鈴臥推', 'chest'],
    ['Incline Dumbbell Press', '上斜啞鈴臥推', 'chest'],
    ['Incline Barbell Press', '上斜槓鈴臥推', 'chest'],
    ['Dumbbell Bench Press', '啞鈴臥推', 'chest'],
    ['Low-to-High Cable Fly', '低位繩索飛鳥', 'chest'],
    ['Push-Up', '伏地挺身', 'chest'],
    ['Pull-Up', '引體向上', 'back'],
    ['Barbell Row', '槓鈴划船', 'back'],
    ['Lat Pulldown', '滑輪下拉', 'back'],
    ['Seated Cable Row', '坐姿繩索划船', 'back'],
    ['One-Arm Dumbbell Row', '單臂啞鈴划船', 'back'],
    ['Deadlift', '硬舉', 'back'],
    ['Overhead Press', '肩推', 'shoulders'],
    ['Lateral Raise', '側平舉', 'shoulders'],
    ['Face Pull', '臉拉', 'shoulders'],
    ['Reverse Pec Deck', '反向飛鳥機', 'shoulders'],
    ['Rear Delt Dumbbell Fly', '啞鈴後三角飛鳥', 'shoulders'],
    ['Barbell Curl', '二頭彎舉', 'biceps'],
    ['Hammer Curl', '錘式彎舉', 'biceps'],
    ['Triceps Pushdown', '三頭下壓', 'triceps'],
    ['Overhead Triceps Extension', '過頭三頭伸展', 'triceps'],
    ['Dips', '雙槓撐體', 'triceps'],
    ['Back Squat', '深蹲', 'legs'],
    ['Romanian Deadlift', '羅馬尼亞硬舉', 'legs'],
    ['Leg Press', '腿推', 'legs'],
    ['Walking Lunge', '行走弓箭步', 'legs'],
    ['Leg Curl', '腿彎舉', 'legs'],
    ['Calf Raise', '小腿提踵', 'legs'],
    ['Hip Thrust', '臀推', 'glutes'],
    ['Plank', '棒式', 'core'],
    ['Hanging Leg Raise', '懸吊舉腿', 'core'],
    ['Burpee', '波比跳', 'core'],
]

export const EXERCISES = EXERCISE_LIST.map(([name, name_zh_tw, muscle_group]) => ({
    id: idFor(name),
    name,
    name_zh_tw,
    muscle_group,
}))
const byName = new Map(EXERCISES.map((e) => [e.name, e]))
export const exerciseId = (name: string) => {
    const e = byName.get(name)
    if (!e) throw new Error(`fixture has no exercise named ${name}`)
    return e.id
}

// [exercise, target sets, target reps, typical working weight kg]
const ROUTINE_PLANS: Record<string, [string, number, number, number][]> = {
    推日: [
        ['Barbell Bench Press', 4, 8, 80],
        ['Incline Dumbbell Press', 3, 10, 26],
        ['Overhead Press', 3, 8, 45],
        ['Triceps Pushdown', 3, 12, 30],
    ],
    拉日: [
        ['Pull-Up', 4, 8, 0],
        ['Barbell Row', 4, 8, 70],
        ['Lat Pulldown', 3, 10, 55],
        ['Barbell Curl', 3, 10, 30],
    ],
    腿日: [
        ['Back Squat', 4, 6, 100],
        ['Romanian Deadlift', 3, 8, 90],
        ['Leg Press', 3, 10, 160],
        ['Burpee', 3, 10, 0],
    ],
}
export const ROUTINES = Object.keys(ROUTINE_PLANS).map((name) => ({ id: idFor(`routine:${name}`), name }))
const routineByName = new Map(ROUTINES.map((r) => [r.name, r]))
// Cycle starts 2026-10-01, so 10-07 is day 1 (push), 10-06 day 3 (legs), 10-05 day 2 (pull)
const CYCLE_START = '2026-10-01'
const CYCLE_DAYS = ['推日', '拉日', '腿日']

function routineForDate(date: string): string {
    const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${CYCLE_START}T00:00:00Z`)) / 86400000)
    return CYCLE_DAYS[((days % 3) + 3) % 3]
}

// Two weeks of history up to yesterday; 10-03 (legs) and 9-25 were skipped
const TRAINED_DATES = [
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-26', '2026-09-27',
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-04',
    '2026-10-05', '2026-10-06',
]

export type FixtureWrite =
    | { op: 'add_today'; exerciseId: string }
    | { op: 'remove_today'; exerciseId: string }
    | { op: 'delete_from_routines'; exerciseId: string; routineIds: string[] }

interface WorkoutRow {
    id: string
    performed_at: string
    planned: string[] // exercise ids
}
interface SetRow {
    workout_id: string
    exercise_id: string
    reps: number
    weight_kg: number
}

/** A fresh copy of the fixture; one per eval case, shared across that case's turns. */
export function createFixtureData(): { data: RonnieData; writes: FixtureWrite[]; proposals: RoutineProposal[] } {
    const writes: FixtureWrite[] = []
    // Proposals change nothing; they are recorded so the grader can see what was offered
    const proposals: RoutineProposal[] = []
    const routineExercises = new Map(
        ROUTINES.map((r) => [r.id, ROUTINE_PLANS[r.name].map(([ex, sets, reps]) => ({ exercise_id: exerciseId(ex), target_sets: sets, target_reps: reps }))])
    )

    const workouts: WorkoutRow[] = []
    const sets: SetRow[] = []
    TRAINED_DATES.forEach((date) => {
        // 19:30 Taipei = 11:30 UTC; small weekly progression on the main lifts
        const w: WorkoutRow = { id: idFor(`workout:${date}`), performed_at: `${date}T11:30:00Z`, planned: [] }
        const week = date < '2026-09-28' ? 0 : 1
        for (const [ex, n, reps, kg] of ROUTINE_PLANS[routineForDate(date)]) {
            w.planned.push(exerciseId(ex))
            for (let s = 0; s < n; s++) {
                sets.push({ workout_id: w.id, exercise_id: exerciseId(ex), reps, weight_kg: kg === 0 ? 0 : kg + week * 2.5 })
            }
        }
        workouts.push(w)
    })
    // Today: the push workout is started, with three sets of bench press logged
    const today: WorkoutRow = {
        id: idFor('workout:2026-10-07'),
        performed_at: '2026-10-07T01:30:00Z',
        planned: ROUTINE_PLANS['推日'].map(([ex]) => exerciseId(ex)),
    }
    workouts.push(today)
    for (let s = 0; s < 3; s++) sets.push({ workout_id: today.id, exercise_id: exerciseId('Barbell Bench Press'), reps: 8, weight_kg: 82.5 })

    const exerciseNames = (id: string) => {
        const e = EXERCISES.find((x) => x.id === id)
        return e ? { name: e.name, name_zh_tw: e.name_zh_tw } : null
    }
    const planned = (w: WorkoutRow): PlannedExercise[] => w.planned.map((id) => ({ exercise_id: id, exercises: exerciseNames(id) }))
    // Postgres ILIKE '%q%': case-insensitive substring
    const ilike = (value: string | null, q: string) => (value ?? '').toLowerCase().includes(q.toLowerCase())

    const data: RonnieData = {
        async findRoutinesByName(name) {
            return ROUTINES.filter((r) => ilike(r.name, name))
        },
        async getRoutineExercises(routineId) {
            return (routineExercises.get(routineId) ?? []).map((re) => {
                const e = EXERCISES.find((x) => x.id === re.exercise_id)!
                return { exercise_id: re.exercise_id, target_sets: re.target_sets, target_reps: re.target_reps, exercises: { name: e.name, name_zh_tw: e.name_zh_tw, muscle_group: e.muscle_group } }
            })
        },
        async getRoutinePlan(routineId) {
            return (routineExercises.get(routineId) ?? []).map((re) => ({ ...re, exercises: exerciseNames(re.exercise_id) }))
        },
        async getRoutineName(routineId) {
            return ROUTINES.find((r) => r.id === routineId)?.name ?? null
        },
        async getTodayRoutineId() {
            return routineByName.get(routineForDate(localDateStr(FIXTURE_NOW, FIXTURE_TIME_ZONE)))!.id
        },
        async getUserRoutineIds() {
            return ROUTINES.map((r) => r.id)
        },
        async findRoutinesWithExercise(id) {
            return ROUTINES.filter((r) => (routineExercises.get(r.id) ?? []).some((re) => re.exercise_id === id))
        },
        async listExercises() {
            return EXERCISES
        },
        async getWorkoutsBetween(startIso, endIso) {
            return workouts
                .filter((w) => w.performed_at >= startIso && w.performed_at <= endIso)
                .sort((a, b) => a.performed_at.localeCompare(b.performed_at))
                .map((w) => ({ id: w.id, performed_at: w.performed_at, workout_planned_exercises: planned(w) }))
        },
        async getLatestWorkoutBetween(startIso, endIso) {
            const w = workouts.filter((x) => x.performed_at >= startIso && x.performed_at <= endIso).sort((a, b) => b.performed_at.localeCompare(a.performed_at))[0]
            return w ? { id: w.id, workout_planned_exercises: planned(w) } : null
        },
        async getSets(workoutIds) {
            return sets.filter((s) => workoutIds.includes(s.workout_id))
        },
        async ensureTodayWorkout() {
            return today.id
        },
        async addPlannedExercise(workoutId, id) {
            writes.push({ op: 'add_today', exerciseId: id })
            // Like the real table, a row must reference an existing exercise
            if (!EXERCISES.some((e) => e.id === id)) return 'insert or update on table "workout_planned_exercises" violates foreign key constraint'
            if (workoutId === today.id && !today.planned.includes(id)) today.planned.push(id)
            return null
        },
        async removePlannedExercise(workoutId, id) {
            writes.push({ op: 'remove_today', exerciseId: id })
            // Like a real DELETE, an id that isn't planned today removes nothing
            const before = today.planned.length
            if (workoutId === today.id) today.planned = today.planned.filter((x) => x !== id)
            return { error: null, removed: before - today.planned.length }
        },
        async deleteExerciseFromRoutines(routineIds, id) {
            writes.push({ op: 'delete_from_routines', exerciseId: id, routineIds })
            for (const rid of routineIds) {
                routineExercises.set(rid, (routineExercises.get(rid) ?? []).filter((re) => re.exercise_id !== id))
            }
            return null
        },
        async createProposal(proposal) {
            proposals.push(proposal)
            return { id: `proposal-${proposals.length}` }
        },
    }
    return { data, writes, proposals }
}

/** What the coach route puts in the system prompt for this user. */
export const FIXTURE_USER = {
    displayName: 'Alex',
    goal: '增肌，三個月內臥推 100 公斤',
    todayRoutineName: '推日',
    weightUnit: 'kg',
    timezone: FIXTURE_TIME_ZONE,
    dates: dateGuide(FIXTURE_NOW, FIXTURE_TIME_ZONE),
}
