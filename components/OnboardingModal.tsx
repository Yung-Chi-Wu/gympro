'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from 'next-themes'
import type { WeightUnit } from '@/lib/weight-unit'
import { toFriendlyError } from '@/lib/friendly-error'
import { reportClientError } from '@/lib/report-client-error'
import { MAX_DISPLAY_NAME_CHARS, MAX_TRAINING_GOAL_CHARS } from '@/lib/text-limits'
import { GOAL_CHOICES, goalText } from '@/lib/goal-choices'
import { InstallGuide } from './InstallGuide'

interface OnboardingModalProps {
    userId: string
    language: string
    /** Replayed from Settings: closing saves nothing */
    onClose?: () => void
}

// The choices first, then a tour of the app in its own words. Replayed from Settings it is
// only the tour: the choices live in Settings, and starting them over would show the
// defaults rather than what the user has.
const CHOICE_STEPS = ['lang', 'theme', 'unit', 'profile', 'goal']
const TOUR_STEPS = ['routines', 'log', 'ronnie', 'checkin', 'report', 'pwa']

export function OnboardingModal({ userId, language, onClose }: OnboardingModalProps) {
    const supabase = createClient()
    const { setTheme } = useTheme()

    const [step, setStep] = useState(0)
    const [visible, setVisible] = useState(true)
    const [selectedLang, setSelectedLang] = useState(language)
    const [selectedUnit, setSelectedUnit] = useState<WeightUnit>('kg')
    const [selectedTheme, setSelectedTheme] = useState('system')
    const [displayName, setDisplayName] = useState('')
    const [sex, setSex] = useState('')
    const [dateOfBirth, setDateOfBirth] = useState('')
    const [heightCm, setHeightCm] = useState('')
    const [goalKinds, setGoalKinds] = useState<string[]>([])
    const [goalWords, setGoalWords] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const zh = selectedLang === 'zh-TW'
    const STEPS = onClose ? TOUR_STEPS : [...CHOICE_STEPS, ...TOUR_STEPS]
    const isLast = step === STEPS.length - 1
    const isFirst = step === 0
    // From the profile step on, which is all optional
    const canSkip = !!onClose || step >= CHOICE_STEPS.indexOf('profile')

    async function handleFinish() {
        if (onClose) {
            onClose()
            setVisible(false)
            return
        }

        const updates: Record<string, unknown> = {
            onboarding_completed: true,
            weight_unit: selectedUnit,
            language: selectedLang,
        }
        if (displayName.trim()) updates.display_name = displayName.trim()
        if (sex) updates.sex = sex
        if (dateOfBirth) updates.date_of_birth = dateOfBirth
        if (heightCm) updates.height_cm = Number(heightCm)
        const goal = goalText(goalKinds, goalWords, selectedLang === 'zh-TW')
        if (goal) updates.training_goal = goal

        setSaving(true)
        setSaveError(null)
        const { error } = await supabase.from('user_profiles').update(updates as never).eq('user_id', userId)
        if (error) {
            reportClientError('client/onboarding/save', error)
            // Nothing is marked done, so the choices aren't lost: the user can try again
            setSaving(false)
            setSaveError(toFriendlyError(error, selectedLang))
            return
        }
        document.cookie = `language=${selectedLang}; path=/; max-age=${60 * 60 * 24 * 365}`
        localStorage.setItem('onboarding_completed', 'true')
        setTheme(selectedTheme)
        window.location.href = '/dashboard'
    }

    if (!visible) return null

    const currentStep = STEPS[step]

    const optionClass = (selected: boolean) =>
        `flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-colors ${selected
            ? 'border-[#26241F] bg-[#26241F] text-white dark:border-white dark:bg-white dark:text-[#1A1814]'
            : 'border-black/10 dark:border-white/15 text-black/50 dark:text-white/50 hover:border-black/20 dark:hover:border-white/30'
        }`

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center sm:pb-0">
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#2C2923] p-6 shadow-xl space-y-5">

                {/* Progress dots */}
                <div className="flex justify-center gap-1.5">
                    {STEPS.map((_, i) => (
                        <div key={i} className={`h-1.5 rounded-full transition-all ${i === step
                                ? 'w-6 bg-[#26241F] dark:bg-white'
                                : i < step
                                    ? 'w-1.5 bg-[#26241F]/30 dark:bg-white/30'
                                    : 'w-1.5 bg-black/10 dark:bg-white/10'
                            }`} />
                    ))}
                </div>

                {/* ── lang ── */}
                {currentStep === 'lang' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">🌐</div>
                            <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">Language / 語言</h2>
                        </div>
                        <div className="flex gap-3">
                            <button type="button" className={optionClass(selectedLang === 'en')} onClick={() => setSelectedLang('en')}>English</button>
                            <button type="button" className={optionClass(selectedLang === 'zh-TW')} onClick={() => setSelectedLang('zh-TW')}>繁體中文</button>
                        </div>
                        <p className="text-center text-xs text-black/40 dark:text-white/40">
                            {selectedLang === 'zh-TW' ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                        </p>
                    </div>
                )}

                {/* ── theme ── */}
                {currentStep === 'theme' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">🌓</div>
                            <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                                {zh ? '顯示模式' : 'Display Mode'}
                            </h2>
                            <p className="text-sm text-black/50 dark:text-white/50">
                                {zh ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {[
                                { value: 'system', zh: '系統', en: 'System' },
                                { value: 'light', zh: '日間', en: 'Light' },
                                { value: 'dark', zh: '夜間', en: 'Dark' },
                            ].map((opt) => (
                                <button key={opt.value} type="button"
                                    className={optionClass(selectedTheme === opt.value)}
                                    onClick={() => setSelectedTheme(opt.value)}>
                                    {zh ? opt.zh : opt.en}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── unit ── */}
                {currentStep === 'unit' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-4xl">⚖️</div>
                            <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                                {zh ? '選擇重量單位' : 'Choose Weight Unit'}
                            </h2>
                            <p className="text-sm text-black/50 dark:text-white/50">
                                {zh ? '之後可以在設定裡更改' : 'You can change this in Settings anytime'}
                            </p>
                        </div>
                        <div className="flex gap-3">
                            {(['kg', 'lb'] as WeightUnit[]).map((unit) => (
                                <button key={unit} type="button"
                                    className={optionClass(selectedUnit === unit)}
                                    onClick={() => setSelectedUnit(unit)}>
                                    {unit}
                                    <span className="block text-xs font-normal mt-0.5">
                                        {unit === 'kg' ? (zh ? '公斤' : 'Kilogram') : (zh ? '磅' : 'Pound')}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── profile ── */}
                {currentStep === 'profile' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-1">
                            <div className="text-4xl">👤</div>
                            <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                                {zh ? '建立你的個人檔案' : 'Your Profile'}
                            </h2>
                            <p className="text-xs text-black/40 dark:text-white/40">
                                {zh ? '幫助 AI 給你更準確的建議（全部選填）' : 'Helps AI give better advice — all optional'}
                            </p>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-black/60 dark:text-white/60 block mb-1">
                                    {zh ? '暱稱' : 'Display Name'}
                                </label>
                                <input type="text" value={displayName} maxLength={MAX_DISPLAY_NAME_CHARS}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder={zh ? '你想怎麼被稱呼？' : 'What should we call you?'}
                                    className="w-full rounded-lg border border-black/15 dark:border-white/15 px-3 py-2 text-sm bg-white dark:bg-[#3A3733] text-[#1A1814] dark:text-[#EAE7E0]" />
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-black/60 dark:text-white/60 block mb-1">
                                        {zh ? '性別' : 'Gender'}
                                    </label>
                                    <select value={sex} onChange={(e) => setSex(e.target.value)}
                                        className="w-full rounded-lg border border-black/15 dark:border-white/15 px-3 py-2 text-sm bg-white dark:bg-[#3A3733] text-[#1A1814] dark:text-[#EAE7E0]">
                                        <option value="">{zh ? '不想說' : 'Prefer not to say'}</option>
                                        <option value="male">{zh ? '男性' : 'Male'}</option>
                                        <option value="female">{zh ? '女性' : 'Female'}</option>
                                        <option value="other">{zh ? '其他' : 'Other'}</option>
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-black/60 dark:text-white/60 block mb-1">
                                        {zh ? '身高 (cm)' : 'Height (cm)'}
                                    </label>
                                    <input type="text" inputMode="decimal" value={heightCm}
                                        onChange={(e) => setHeightCm(e.target.value)} placeholder="175"
                                        className="w-full rounded-lg border border-black/15 dark:border-white/15 px-3 py-2 text-sm bg-white dark:bg-[#3A3733] text-[#1A1814] dark:text-[#EAE7E0]" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-black/60 dark:text-white/60 block mb-1">
                                    {zh ? '出生日期' : 'Date of Birth'}
                                </label>
                                <input type="date" value={dateOfBirth}
                                    onChange={(e) => setDateOfBirth(e.target.value)}
                                    className="w-full rounded-lg border border-black/15 dark:border-white/15 px-3 py-2 text-sm bg-white dark:bg-[#3A3733] text-[#1A1814] dark:text-[#EAE7E0]" />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── goal ── */}
                {currentStep === 'goal' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-1">
                            <div className="text-4xl">🎯</div>
                            <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                                {zh ? '你最想練出什麼？' : 'What are you training for?'}
                            </h2>
                            <p className="text-xs text-black/40 dark:text-white/40">
                                {zh ? '可以複選，週報和 Ronnie 會照這個給建議' : 'Pick any. Your report and Ronnie go by it'}
                            </p>
                        </div>
                        <div role="group" aria-label={zh ? '目標' : 'Goal'} className="grid grid-cols-3 gap-2">
                            {GOAL_CHOICES.map((c) => {
                                const on = goalKinds.includes(c.key)
                                return (
                                    <button key={c.key} type="button" aria-pressed={on} className={optionClass(on)}
                                        onClick={() => setGoalKinds((k) => (on ? k.filter((x) => x !== c.key) : [...k, c.key]))}>
                                        {zh ? c.zh : c.en}
                                    </button>
                                )
                            })}
                        </div>
                        <div>
                            <label htmlFor="onboarding-goal" className="text-xs font-medium text-black/60 dark:text-white/60 block mb-1">
                                {zh ? '具體一點（選填）' : 'Anything specific? (optional)'}
                            </label>
                            <input id="onboarding-goal" type="text" value={goalWords} maxLength={MAX_TRAINING_GOAL_CHARS - 40}
                                onChange={(e) => setGoalWords(e.target.value)}
                                placeholder={selectedUnit === 'lb'
                                    ? (zh ? '例如：深蹲 300 lb、減到 165 lb' : 'e.g. squat 300 lb, get down to 165 lb')
                                    : (zh ? '例如：深蹲 140 kg、減到 75 kg' : 'e.g. squat 140 kg, get down to 75 kg')}
                                className="w-full rounded-lg border border-black/15 dark:border-white/15 px-3 py-2 text-sm bg-white dark:bg-[#3A3733] text-[#1A1814] dark:text-[#EAE7E0]" />
                        </div>
                    </div>
                )}

                {/* ── routines ── */}
                {currentStep === 'routines' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">📋</div>
                        <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                            {zh ? '排好課表' : 'Plan Your Routines'}
                        </h2>
                        <p className="text-sm text-black/50 dark:text-white/50 leading-relaxed">
                            {zh
                                ? '到「課表」為每個訓練日建立一份課表，再設定訓練循環：幾天一輪、每天練哪一份。不知道怎麼排，可以讓 Coach G 幫你排。'
                                : 'In Routines, make a routine for each training day, then set your training cycle: how many days it runs and which routine goes on each day. Not sure how? Coach G can plan them for you.'}
                        </p>
                    </div>
                )}

                {/* ── log ── */}
                {currentStep === 'log' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">💪</div>
                        <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                            {zh ? '在「今天」記錄每一組' : 'Log Each Set in Today'}
                        </h2>
                        <p className="text-sm text-black/50 dark:text-white/50 leading-relaxed">
                            {zh
                                ? '打開「今天」，當天排的課表會自動帶出來，把每一組的重量和次數記下來。沒排課表的日子，也可以直接加動作。'
                                : "Open Today: the routine planned for the day is already there. Log the weight and reps of each set. On a day with nothing planned, add exercises yourself."}
                        </p>
                    </div>
                )}

                {/* ── ronnie ── */}
                {currentStep === 'ronnie' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">💬</div>
                        <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                            {zh ? '有問題就問 Ronnie' : 'Ask Ronnie'}
                        </h2>
                        <p className="text-sm text-black/50 dark:text-white/50 leading-relaxed">
                            {zh
                                ? 'Ronnie 是你的 AI 教練。它會先看過你實際練了什麼再回答，也能幫你調整今天的訓練或課表，還會記得你說過的舊傷和偏好。'
                                : "Ronnie is your AI coach. It looks at what you've actually trained before it answers, can change today's workout or your routines for you, and remembers the injuries and preferences you tell it about."}
                        </p>
                        <p className="text-xs text-black/40 dark:text-white/40 leading-relaxed">
                            {zh
                                ? '手機上點畫面上的圓形對話按鈕，電腦上點側邊欄的「問 Ronnie」。'
                                : 'On a phone, tap the round chat button. On a computer, click Ask Ronnie in the sidebar.'}
                        </p>
                    </div>
                )}

                {/* ── checkin ── */}
                {currentStep === 'checkin' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">⚖️</div>
                        <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                            {zh ? '記下體重和當天狀況' : 'Note Your Weight and Your Day'}
                        </h2>
                        <p className="text-sm text-black/50 dark:text-white/50 leading-relaxed">
                            {zh
                                ? '「今天」也可以記體重，或寫一句當天的備註，例如「睡不好」「右肩有點卡」，報告會把這些一起考慮進去。'
                                : 'Today also takes your weight and a note on the day, like "slept badly" or "right shoulder felt stuck". Your report takes them into account.'}
                        </p>
                    </div>
                )}

                {/* ── report ── */}
                {currentStep === 'report' && (
                    <div className="text-center space-y-3">
                        <div className="text-5xl">🤖</div>
                        <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                            {zh ? '每一期一份報告' : 'A Report Every Period'}
                        </h2>
                        <p className="text-sm text-black/50 dark:text-white/50 leading-relaxed">
                            {zh
                                ? '每週（週一到週日）結束後，會自動產生這一期的報告，給你下一期的具體建議；有設訓練循環的話，是每一輪結束後。'
                                : 'When each week (Monday to Sunday) ends, or each round of your training cycle if you set one, you get a report with specific advice for the next one.'}
                        </p>
                        <p className="text-xs text-black/40 dark:text-white/40 leading-relaxed">
                            {zh
                                ? '一期至少要記 10 組才會產生報告。摘要在「今天」，完整報告在「紀錄」。'
                                : 'A period needs at least 10 logged sets for a report. The summary is in Today, the full report in History.'}
                        </p>
                    </div>
                )}

                {/* ── pwa ── */}
                {currentStep === 'pwa' && (
                    <div className="space-y-4">
                        <div className="text-center space-y-2">
                            <div className="text-5xl">📱</div>
                            <h2 className="text-xl font-bold text-[#1A1814] dark:text-[#EAE7E0]">
                                {zh ? '加到主畫面' : 'Add to Home Screen'}
                            </h2>
                            <p className="text-sm text-black/50 dark:text-white/50">
                                {zh ? '把 GymPro 加到主畫面，像 App 一樣一鍵開啟。' : 'Add GymPro to your home screen for quick access.'}
                            </p>
                        </div>
                        {/* Steps for the browser this is open in: Safari, another iOS browser, or already installed */}
                        <div className="rounded-xl bg-black/5 p-3 dark:bg-white/8">
                            <InstallGuide zh={zh} />
                        </div>
                    </div>
                )}

                {/* Step counter */}
                <p className="text-center text-xs text-black/30 dark:text-white/30">
                    {step + 1} / {STEPS.length}
                </p>

                {saveError && <p role="alert" className="text-center text-sm text-miss">{saveError}</p>}

                {/* Buttons */}
                <div className="flex gap-2">
                    {!isFirst && (
                        <button type="button" disabled={saving}
                            onClick={() => setStep((s) => s - 1)}
                            className="flex-1 rounded-md border border-black/15 dark:border-white/15 px-4 py-2 text-sm text-black/60 dark:text-white/60">
                            {zh ? '上一步' : 'Back'}
                        </button>
                    )}
                    <button type="button" disabled={saving}
                        onClick={isLast ? handleFinish : () => setStep((s) => s + 1)}
                        className="flex-1 rounded-md bg-[#26241F] dark:bg-white px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#1A1814]">
                        {isLast ? (zh ? '開始使用' : "Let's go") : (zh ? '下一步' : 'Next')}
                    </button>
                </div>

                {canSkip && !isLast && (
                    <button type="button" onClick={handleFinish} disabled={saving}
                        className="block w-full text-center text-xs text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60">
                        {zh ? '跳過' : 'Skip'}
                    </button>
                )}
            </div>
        </div>
    )
}