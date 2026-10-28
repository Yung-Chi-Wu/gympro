'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { REPS, SETS } from '@/lib/coach-g'
import { reportClientError, responseError } from '@/lib/report-client-error'
import { createClient } from '@/lib/supabase/client'
import { serverWrite } from '@/lib/data-version'
import { answersGoalText } from '@/lib/goal-choices'
import { BUTTON } from '@/lib/ui'

interface GeneratedExercise {
    exercise_id: string
    exercise_name: string
    exercise_name_zh_tw?: string
    muscle_group: string
    target_sets: number
    target_reps: number
}

interface GeneratedRoutine {
    name: string
    name_zh_tw?: string
    day_indices: number[]
    exercises: GeneratedExercise[]
}

interface CoachGResultProps {
    routines: GeneratedRoutine[]
    cycleLength: number
    language: string
    onBack: () => void
    onSaved: () => void
    /** The header's back button: Redesign in Coach G's chat; Close from Ronnie's plan card */
    backLabel?: string
    /**
     * The goals the chat was told. Once the plan is saved, a user with no goal is offered them as
     * one, so what Coach G asked isn't asked again (owner, 2026-10-28). Ronnie's plan card has none.
     */
    goals?: string[]
}

/** The goal offered after saving: the user's profile row, and the text */
interface GoalOffer {
    userId: string
    text: string
}

export function CoachGResult({ routines, cycleLength, language, onBack, onSaved, backLabel, goals = [] }: CoachGResultProps) {
    const zh = language === 'zh-TW'
    const router = useRouter()
    const [editableRoutines, setEditableRoutines] = useState<GeneratedRoutine[]>(routines)
    const [startDayIndex, setStartDayIndex] = useState(1)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [goalOffer, setGoalOffer] = useState<GoalOffer | null>(null)
    const [savingGoal, setSavingGoal] = useState(false)
    const [goalError, setGoalError] = useState<string | null>(null)
    // The save is one transaction: when it fails, the user's routines are as they were
    const saveError = zh ? '存不進去，你原本的課表沒有變動。請再試一次。' : "Couldn't save; your routines are unchanged. Please try again."
    const replaceQuestion = (count: number | null) => zh
        ? `存入會取代你目前的${count ? ` ${count} 份` : ''}課表和訓練循環，無法復原。要存入嗎？`
        : `Saving replaces your ${count ? `${count} current routine${count === 1 ? '' : 's'}` : 'current routines'} and your training cycle, and can't be undone. Save?`
    const setsRepsError = zh
        ? `組數要在 ${SETS.min} 到 ${SETS.max} 之間，次數要在 ${REPS.min} 到 ${REPS.max} 之間。`
        : `Sets must be ${SETS.min} to ${SETS.max} and reps ${REPS.min} to ${REPS.max}.`

    /** The chat's goals, to offer when the user has no goal yet; null when there is nothing to ask */
    async function goalToOffer(): Promise<GoalOffer | null> {
        const text = answersGoalText(goals, zh)
        if (!text) return null
        const { data, error: profileError } = await createClient().from('user_profiles').select('user_id, training_goal').maybeSingle()
        // Not knowing is not asking: the routines are saved either way
        if (profileError || !data || data.training_goal?.trim()) return null
        return { userId: data.user_id, text }
    }

    async function saveGoal() {
        if (!goalOffer || savingGoal) return
        setSavingGoal(true)
        setGoalError(null)
        const { error: saveGoalError } = await createClient()
            .from('user_profiles')
            .update({ training_goal: goalOffer.text, updated_at: new Date().toISOString() })
            .eq('user_id', goalOffer.userId)
        setSavingGoal(false)
        if (saveGoalError) {
            reportClientError('client/coach-g/save-goal', saveGoalError)
            setGoalError(zh ? '目標沒存進去，請再試一次。課表已經存好了。' : "Couldn't save the goal; please try again. Your routines are saved.")
            return
        }
        router.refresh()
        onSaved()
    }

    function getRoutineName(routine: GeneratedRoutine) {
        return zh && routine.name_zh_tw ? routine.name_zh_tw : routine.name
    }

    function getExerciseName(ex: GeneratedExercise) {
        return zh && ex.exercise_name_zh_tw ? ex.exercise_name_zh_tw : ex.exercise_name
    }

    function updateSets(ri: number, ei: number, value: number) {
        setEditableRoutines((prev) =>
            prev.map((r, i) => i !== ri ? r : {
                ...r,
                exercises: r.exercises.map((ex, j) =>
                    j !== ei ? ex : { ...ex, target_sets: value }
                ),
            })
        )
    }

    function updateReps(ri: number, ei: number, value: number) {
        setEditableRoutines((prev) =>
            prev.map((r, i) => i !== ri ? r : {
                ...r,
                exercises: r.exercises.map((ex, j) =>
                    j !== ei ? ex : { ...ex, target_reps: value }
                ),
            })
        )
    }

    function removeExercise(ri: number, ei: number) {
        setEditableRoutines((prev) =>
            prev.map((r, i) => i !== ri ? r : {
                ...r,
                exercises: r.exercises.filter((_, j) => j !== ei),
            })
        )
    }

    async function handleSave() {
        if (isSaving) return
        setIsSaving(true)
        setError(null)
        // Saving replaces every routine and the cycle, so it's asked here, at the button, with how
        // many go; the warning when Coach G opened may be long gone (or never seen, from Ronnie's card)
        const { count, error: countError } = await createClient().from('routines').select('id', { count: 'exact', head: true })
        if ((countError || (count ?? 0) > 0) && !confirm(replaceQuestion(countError ? null : count))) {
            setIsSaving(false)
            return
        }

        try {
            const res = await serverWrite(() => fetch('/api/ai/save-routine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: editableRoutines,
                    cycleLength,
                    startDayIndex,
                    language,
                }),
            }))

            const data = await res.json()
            if (!data.success) {
                reportClientError('client/coach-g/save', responseError(`Save request failed: ${res.status}`, res.status, data))
                setError(data.error === 'sets_reps' ? setsRepsError : saveError)
                return
            }

            router.refresh()
            const offer = await goalToOffer()
            if (offer) {
                setGoalOffer(offer)
                return
            }
            onSaved()
        } catch (err) {
            reportClientError('client/coach-g/save', err)
            setError(saveError)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-ink/10">
                <div>
                    <p className="font-semibold">
                        {zh ? '✨ Coach G 的課表建議' : "✨ Coach G's Routine"}
                    </p>
                    {!goalOffer && (
                        <p className="text-xs text-ink/40">
                            {zh ? '可以直接修改，滿意後再存入' : 'Edit freely, then save when ready'}
                        </p>
                    )}
                </div>
                {/* Saved: there is nothing left to edit, redesign or close back to */}
                {!goalOffer && (
                    <button type="button" onClick={onBack}
                        className="text-sm text-ink/40 hover:text-ink transition-colors">
                        {backLabel ?? (zh ? '重新設計' : 'Redesign')}
                    </button>
                )}
            </div>

            {goalOffer ? (
                <div role="status" className="flex flex-1 flex-col justify-center gap-4 p-6">
                    <p className="text-[15px] font-semibold text-good md:text-sm">{zh ? '課表和訓練循環存好了。' : 'Your routines and cycle are saved.'}</p>
                    <p className="text-[15px] md:text-sm">
                        {zh
                            ? `要把「${goalOffer.text}」存成你的目標嗎？週報會照它看你的進度。`
                            : `Save "${goalOffer.text}" as your goal? Your weekly report tracks your progress toward it.`}
                    </p>
                    {goalError && <p className="text-sm text-miss">{goalError}</p>}
                    <div className="flex gap-2">
                        <button type="button" onClick={saveGoal} disabled={savingGoal} className={`${BUTTON.primary} flex-1`}>
                            {savingGoal ? (zh ? '儲存中…' : 'Saving…') : (zh ? '存成目標' : 'Save as goal')}
                        </button>
                        <button type="button" onClick={onSaved} disabled={savingGoal} className={`${BUTTON.secondary} flex-1`}>
                            {zh ? '不用' : 'No thanks'}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {error && <p className="text-sm text-red-600">{error}</p>}

                    {/* 循環說明 */}
                    <div className="rounded-xl bg-ink/5 p-3 space-y-3">
                        <p className="text-sm font-medium">
                            {zh
                                ? `📅 ${cycleLength} 天訓練循環`
                                : `📅 ${cycleLength}-Day Training Cycle`}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {Array.from({ length: cycleLength }, (_, i) => i + 1).map((day) => {
                                const routine = editableRoutines.find((r) => r.day_indices?.includes(day))
                                return (
                                    <div key={day}
                                        className="flex flex-col items-center rounded-lg border border-ink/10 px-2 py-1.5 min-w-[44px]">
                                        <span className="text-xs text-ink/40">
                                            {zh ? `第${day}天` : `D${day}`}
                                        </span>
                                        <span className="text-xs font-medium truncate max-w-[60px]">
                                            {routine
                                                ? getRoutineName(routine).split(/[ （(]/)[0]
                                                : (zh ? '休息' : 'Rest')}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>

                        {/* 今天是第幾天 */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-ink/60 shrink-0">
                                {zh ? '今天是循環的第' : 'Today is day'}
                            </label>
                            <select
                                value={startDayIndex}
                                onChange={(e) => setStartDayIndex(Number(e.target.value))}
                                className="rounded-md border border-ink/20 px-2 py-1 text-xs"
                            >
                                {Array.from({ length: cycleLength }, (_, i) => i + 1).map((day) => (
                                    <option key={day} value={day}>
                                        {zh ? `第 ${day} 天` : `Day ${day}`}
                                    </option>
                                ))}
                            </select>
                            {zh ? <span className="text-xs text-ink/60">（設定訓練起點）</span>
                                : <span className="text-xs text-ink/60">(set your starting point)</span>}
                        </div>
                    </div>

                    {/* 課表列表 */}
                    {editableRoutines.map((routine, ri) => (
                        <div key={ri} className="rounded-xl border border-ink/10 bg-white p-4 space-y-3">
                            <div>
                                <p className="font-semibold">{getRoutineName(routine)}</p>
                                <p className="text-xs text-ink/40">
                                    {routine.day_indices?.map((d) =>
                                        zh ? `第 ${d} 天` : `Day ${d}`
                                    ).join('、')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                {routine.exercises.map((ex, ei) => (
                                    <div key={ei} className="flex items-center gap-2 text-sm">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-ink/40">
                                                {getMuscleGroupLabel(ex.muscle_group, language)}
                                            </p>
                                            <p className="font-medium truncate">
                                                {getExerciseName(ex)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <input type="text" inputMode="numeric"
                                                value={ex.target_sets}
                                                onChange={(e) => updateSets(ri, ei, Number(e.target.value))}
                                                className="w-10 text-center rounded border border-ink/10 py-0.5 text-xs"
                                            />
                                            <span className="text-ink/40 text-xs">×</span>
                                            <input type="text" inputMode="numeric"
                                                value={ex.target_reps}
                                                onChange={(e) => updateReps(ri, ei, Number(e.target.value))}
                                                className="w-10 text-center rounded border border-ink/10 py-0.5 text-xs"
                                            />
                                        </div>
                                        <button type="button" onClick={() => removeExercise(ri, ei)}
                                            className="text-ink/30 hover:text-red-500 transition-colors ml-1">
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Save */}
                <div className="p-4 border-t border-ink/10">
                    <button type="button" onClick={handleSave} disabled={isSaving}
                        className="w-full rounded-xl bg-plate dark:bg-white py-3 text-sm font-semibold text-chalk dark:text-[#1A1814] disabled:opacity-50 hover:opacity-90 transition-opacity">
                        {isSaving
                            ? (zh ? '存入中...' : 'Saving...')
                            : (zh ? '✓ 存入課表與訓練循環' : '✓ Save Routines & Cycle')}
                    </button>
                </div>
                </>
            )}
        </div>
    )
}