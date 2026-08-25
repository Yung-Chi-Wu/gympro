'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getMuscleGroupLabel } from '@/lib/exercise-display'

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
}

export function CoachGResult({ routines, cycleLength, language, onBack, onSaved }: CoachGResultProps) {
    const zh = language === 'zh-TW'
    const router = useRouter()
    const [editableRoutines, setEditableRoutines] = useState<GeneratedRoutine[]>(routines)
    const [startDayIndex, setStartDayIndex] = useState(1)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

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
        setIsSaving(true)
        setError(null)

        try {
            const res = await fetch('/api/ai/save-routine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: editableRoutines,
                    cycleLength,
                    startDayIndex,
                }),
            })

            const data = await res.json()
            if (!data.success) throw new Error(data.error ?? 'Save failed')

            router.refresh()
            onSaved()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong')
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
                    <p className="text-xs text-ink/40">
                        {zh ? '可以直接修改，滿意後再存入' : 'Edit freely, then save when ready'}
                    </p>
                </div>
                <button type="button" onClick={onBack}
                    className="text-sm text-ink/40 hover:text-ink transition-colors">
                    {zh ? '重新設計' : 'Redesign'}
                </button>
            </div>

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
                                            ? getRoutineName(routine).split(' ')[0]
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
                    <div key={ri} className="rounded-2xl border border-ink/10 bg-white p-4 space-y-3 shadow-sm">
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
        </div>
    )
}