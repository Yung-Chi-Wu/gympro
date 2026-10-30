'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { setLanguageCookie } from '@/lib/set-language-cookie'
import { serverWrite } from '@/lib/data-version'
import { reportClientError } from '@/lib/report-client-error'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { closeSubPage, openSubPage } from '@/lib/sub-page'
import type { Database } from '@/lib/types/database.types'
import { DeleteAccountButton } from '@/components/DeleteAccountButton'
import { LogoutButton } from '@/components/LogoutButton'
import { ThemeSelector } from '@/components/ThemeSelector'
import { Icon } from '@/components/Icon'
import { InstallGuide } from '@/components/InstallGuide'
import { ReminderSetting } from '@/components/ReminderSetting'
import { FeedbackForm } from '@/components/FeedbackForm'
import { CHOSEN_UTC } from '@/lib/time-zone'
import { MAX_DISPLAY_NAME_CHARS, MAX_TRAINING_GOAL_CHARS } from '@/lib/text-limits'
import { BUTTON, SEGMENTED } from '@/lib/ui'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { unitLabel } from '@/lib/report/volume'
import type { GoalRead } from '@/lib/report/types'
import { useGoalReadLabels } from '@/components/report/goal-text'

// Settings. Side by side (@split): the sections on the left (個人資料, 訓練目標, 單位與語言,
// 外觀, 意見回饋, 帳號), the chosen section's form on the right. On a phone: one grouped list with
// each setting's current value; a setting opens as a page of its own (?item=, see
// lib/sub-page.ts) with its own save button. Under the goal, once saved: the goal as the report
// will read it (app/api/ai/goal), so a goal it can't track is rewritten now, not a week later.

export interface ProfileValues {
    displayName: string
    heightCm: string
    dateOfBirth: string
    sex: string
    timezone: string
    trainingGoal: string
    /** The unit weights are read in (reports, Ronnie, history), not the per-exercise logging unit */
    weightUnit: WeightUnit
    distanceUnit: DistanceUnit
    language: string
}

/** The saved goal as read: being read, read, or not read this time */
type GoalReadState = { text: string; status: 'reading' | 'done' | 'failed'; read: GoalRead | null }
/** Reads the saved goal, once a text: Settings asks when the goal is shown */
type ReadGoal = (text: string) => void

/** The profile plus the theme, which lives in the browser (next-themes), not the database */
type Values = ProfileValues & { theme: string }
type Field = keyof Values
type Section = 'profile' | 'goal' | 'units' | 'appearance' | 'feedback' | 'account'
/** What a phone row opens: a setting, the add-to-home-screen steps, or the feedback form */
type Item = Field | 'install' | 'feedback'

const SECTIONS: { key: Section; fields: Field[] }[] = [
    { key: 'profile', fields: ['displayName', 'heightCm', 'dateOfBirth', 'sex', 'timezone'] },
    { key: 'goal', fields: ['trainingGoal'] },
    { key: 'units', fields: ['weightUnit', 'distanceUnit', 'language'] },
    { key: 'appearance', fields: ['theme'] },
    { key: 'feedback', fields: [] },
    { key: 'account', fields: [] },
]
// The phone's list groups the same settings more coarsely, like a phone's own settings
const PHONE_GROUPS: { key: string; fields: Field[] }[] = [
    { key: 'personal', fields: ['displayName', 'heightCm', 'dateOfBirth', 'sex', 'timezone'] },
    { key: 'training', fields: ['trainingGoal'] },
    { key: 'preferences', fields: ['weightUnit', 'distanceUnit', 'language', 'theme'] },
    { key: 'account', fields: [] },
]
const FIELDS = SECTIONS.flatMap((s) => s.fields)
const isItem = (s: string | null): s is Item => s === 'install' || s === 'feedback' || FIELDS.includes(s as Field)

// UTC as Etc/UTC: a choice, which TimeZoneSync leaves alone, unlike the column's default 'UTC'
const COMMON_TIMEZONES = [
    CHOSEN_UTC,
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Taipei',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Europe/London',
    'Europe/Paris',
    'Australia/Sydney',
]

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', 'zh-TW': '繁體中文' }

// Phone sizes first (44px targets, 52px rows, 15px text), the denser desktop ones from md
const CARD = 'rounded-card border border-line bg-card p-4'
const INPUT = 'h-11 w-full rounded-field border border-line bg-card px-3 md:h-auto md:py-2'
const TEXTAREA = 'w-full rounded-field border border-line bg-card px-3 py-2.5 md:py-2'
const ROW = 'flex min-h-[52px] w-full items-center gap-3 py-2.5 text-left md:min-h-12'

// The theme is only known in the browser: the server and the first render show none
const subscribeNothing = () => () => {}

export function ProfileSettingsForm({ userId, initial, goalRead: keptRead }: {
    userId: string
    initial: ProfileValues
    /** The read kept with the saved goal, when it read that text */
    goalRead: GoalRead | null
}) {
    const t = useTranslations('settings')
    const router = useRouter()
    const searchParams = useSearchParams()
    const { theme, setTheme } = useTheme()
    const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false)
    const [saved, setSaved] = useState<ProfileValues>(initial)
    const [section, setSection] = useState<Section>('profile')
    const [showOnboarding, setShowOnboarding] = useState(false)
    const [goalRead, setGoalRead] = useState<GoalReadState | null>(keptRead ? { text: keptRead.text, status: 'done', read: keptRead } : null)
    // The text last asked about: each is asked once a visit, and one that couldn't be read waits for the report
    const askedGoal = useRef<string | null>(keptRead?.text ?? null)

    const values: Values = { ...saved, theme: inBrowser ? theme ?? 'system' : '' }
    const itemParam = searchParams.get('item')
    const item = isItem(itemParam) ? itemParam : null
    const isZhTW = saved.language === 'zh-TW'

    /** Saves some settings; the error to show, or null */
    async function save(changes: Partial<Values>): Promise<string | null> {
        const height = changes.heightCm?.trim()
        if (height && !(Number(height) > 0)) return t('heightInvalid')

        if (changes.theme !== undefined) setTheme(changes.theme)

        const row: Database['public']['Tables']['user_profiles']['Insert'] = { user_id: userId, updated_at: new Date().toISOString() }
        if (changes.displayName !== undefined) row.display_name = changes.displayName.trim() || null
        if (height !== undefined) {
            row.height_cm = height ? Number(height) : null
            row.height_updated_at = height ? new Date().toISOString() : null
        }
        if (changes.dateOfBirth !== undefined) row.date_of_birth = changes.dateOfBirth || null
        if (changes.sex !== undefined) row.sex = changes.sex || null
        if (changes.timezone !== undefined) row.timezone = changes.timezone
        if (changes.trainingGoal !== undefined) row.training_goal = changes.trainingGoal.trim() || null
        if (changes.weightUnit !== undefined) row.weight_unit = changes.weightUnit
        if (changes.distanceUnit !== undefined) row.distance_unit = changes.distanceUnit
        if (changes.language !== undefined) row.language = changes.language

        if (Object.keys(row).length > 2) {
            const { error } = await createClient().from('user_profiles').upsert(row, { onConflict: 'user_id' })
            if (error) {
                reportClientError('client/settings/save-profile', error)
                return t('saveFailed', { message: error.message })
            }
        }

        const profileChanges = { ...changes }
        delete profileChanges.theme
        setSaved((prev) => ({ ...prev, ...profileChanges }))
        const language = changes.language
        if (language !== undefined && language !== saved.language) {
            // The page's own text is in the old language until it is drawn again
            await serverWrite(() => setLanguageCookie(language))
            router.refresh()
        }
        return null
    }

    const readGoal = useCallback<ReadGoal>(async (text) => {
        if (askedGoal.current === text) return
        askedGoal.current = text
        setGoalRead({ text, status: 'reading', read: null })
        let read: GoalRead | null = null
        try {
            // It keeps the read with the goal, which Settings shows: a write
            const res = await serverWrite(() => fetch('/api/ai/goal', { method: 'POST' }))
            const data = res.ok ? await res.json() : null
            read = data?.read ?? null
        } catch {
            // Offline or cut off: the report reads it
        }
        setGoalRead((g) => (g?.text !== text ? g
            : read?.model && read.text === text ? { text, status: 'done', read } : { text, status: 'failed', read: null }))
    }, [])

    /** A setting's current value, for the phone's list */
    function shownValue(field: Field): string {
        const v = values[field]
        switch (field) {
            case 'heightCm':
                return v ? t('cm', { value: v }) : t('notSet')
            case 'dateOfBirth':
                return v ? v.replaceAll('-', '/') : t('notSet')
            case 'sex':
                return v ? t(`sexOptions.${v}`) : t('sexOptions.none')
            case 'language':
                return LANGUAGE_NAMES[v] ?? v
            case 'theme':
                return v ? t(`themes.${v}`) : ''
            default:
                return v || t('notSet')
        }
    }

    const accountRows = (
        <>
            <li>
                <ReminderSetting />
            </li>
            <li>
                <button type="button" onClick={() => setShowOnboarding(true)} className={ROW}>
                    <span className="flex-1">{t('tutorial')}</span>
                    <Icon name="forward" className="size-4 text-faint" />
                </button>
            </li>
            <li className="@split:hidden">
                <button type="button" onClick={() => openSubPage('item', 'install')} className={ROW}>
                    <span className="flex-1">{t('install')}</span>
                    <Icon name="forward" className="size-4 text-faint" />
                </button>
            </li>
            <li className="hidden py-3 @split:block">
                <InstallSteps />
            </li>
            {/* Side by side, 意見回饋 is a section of its own */}
            <li className="@split:hidden">
                <button type="button" onClick={() => openSubPage('item', 'feedback')} className={ROW}>
                    <span className="flex-1">{t('feedback.title')}</span>
                    <Icon name="forward" className="size-4 text-faint" />
                </button>
            </li>
            <li>
                <LogoutButton className={`${ROW} justify-between`} />
            </li>
            {/* Apart from 登出 just above, so a tap meant for one doesn't land on the other */}
            <li className="mt-6">
                <DeleteAccountButton isZhTW={isZhTW} className={`${ROW} font-bold text-miss`} />
            </li>
            {/* How long AI calls are kept (lib/ai/trace.ts), said where deleting them is */}
            <li className="py-3 text-xs leading-relaxed text-faint">{t('dataNote')}</li>
        </>
    )

    return (
        <>
            <div className="items-start gap-4 @split:grid @split:grid-cols-[200px_minmax(0,1fr)]">

                {/* Side by side: the sections */}
                <nav aria-label={t('title')} className={`${CARD} hidden p-2 @split:block`}>
                    {SECTIONS.map(({ key }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setSection(key)}
                            aria-current={section === key ? 'true' : undefined}
                            className={`block w-full rounded-field px-3 py-2 text-left text-sm font-medium ${section === key ? 'bg-done text-ink' : 'text-muted hover:text-ink'}`}
                        >
                            {t(`sections.${key}`)}
                        </button>
                    ))}
                </nav>

                {/* Side by side: the chosen section */}
                <div className="hidden max-w-xl @split:block">
                    {section === 'account' ? (
                        <section className={`${CARD} space-y-1`}>
                            <h2 className="text-lg font-bold">{t('sections.account')}</h2>
                            <ul className="divide-y divide-line">{accountRows}</ul>
                        </section>
                    ) : section === 'feedback' ? (
                        <section className={`${CARD} space-y-3`}>
                            <h2 className="text-lg font-bold">{t('feedback.title')}</h2>
                            <FeedbackForm />
                        </section>
                    ) : (
                        <SettingsForm
                            key={section}
                            title={t(`sections.${section}`)}
                            fields={SECTIONS.find((s) => s.key === section)!.fields}
                            values={values}
                            onSave={save}
                            isZhTW={isZhTW}
                            goalRead={goalRead}
                            onReadGoal={readGoal}
                        />
                    )}
                </div>

                {/* Phone: every setting, grouped, with its value */}
                <div className={`space-y-6 @split:hidden ${item ? 'hidden' : ''}`}>
                    {PHONE_GROUPS.map(({ key, fields }) => (
                        <section key={key} className="space-y-2">
                            <h2 className="px-1 text-[13px] tracking-wider text-muted">{t(`groups.${key}`)}</h2>
                            <ul className="divide-y divide-line rounded-card border border-line bg-card px-4">
                                {key === 'account' ? accountRows : fields.map((field) => (
                                    <li key={field}>
                                        <button type="button" onClick={() => openSubPage('item', field)} className={ROW}>
                                            <span className="shrink-0">{t(`fields.${field}`)}</span>
                                            <span className="min-w-0 flex-1 truncate text-right text-muted">{shownValue(field)}</span>
                                            <Icon name="forward" className="size-4 text-faint" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>

                {/* Phone: one setting */}
                {item && (
                    <div className="@split:hidden">
                        {item === 'install' ? (
                            <section className={`${CARD} space-y-3`}>
                                <BackToSettings />
                                <h2 className="text-xl font-bold">{t('install')}</h2>
                                <InstallSteps showTitle={false} />
                            </section>
                        ) : item === 'feedback' ? (
                            <section className={`${CARD} space-y-3`}>
                                <BackToSettings />
                                <h2 className="text-xl font-bold">{t('feedback.title')}</h2>
                                <FeedbackForm />
                            </section>
                        ) : (
                            <SettingsForm key={item} title={t(`fields.${item}`)} fields={[item]} values={values} onSave={save} isZhTW={isZhTW} goalRead={goalRead} onReadGoal={readGoal} single />
                        )}
                    </div>
                )}
            </div>

            {showOnboarding && (
                <OnboardingModalWrapper
                    userId={userId}
                    language={saved.language}
                    onClose={() => setShowOnboarding(false)}
                />
            )}
        </>
    )
}

/** Back to the list when the page is too narrow for both and there is no phone top bar */
function BackToSettings() {
    const t = useTranslations('settings')
    return (
        <button
            type="button"
            onClick={() => closeSubPage('item')}
            className="hidden items-center gap-0.5 text-sm font-medium text-accent md:@max-split:flex"
        >
            <Icon name="back" className="size-4" />
            {t('title')}
        </button>
    )
}

interface SettingsFormProps {
    title: string
    fields: Field[]
    values: Values
    onSave: (changes: Partial<Values>) => Promise<string | null>
    isZhTW: boolean
    goalRead: GoalReadState | null
    onReadGoal: ReadGoal
    /** One setting on its own page: the title is its label */
    single?: boolean
}

/** A section's settings, or a single one, with a save button */
function SettingsForm({ title, fields, values, onSave, isZhTW, goalRead, onReadGoal, single = false }: SettingsFormProps) {
    const t = useTranslations('settings')
    const [draft, setDraft] = useState<Values>(values)
    const [saving, setSaving] = useState(false)
    const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        setStatus(null)
        const error = await onSave(Object.fromEntries(fields.map((f) => [f, draft[f]])))
        setSaving(false)
        setStatus(error ? { ok: false, text: error } : { ok: true, text: t('saved') })
    }

    const set = (field: Field, value: string) => {
        setStatus(null)
        setDraft((d) => ({ ...d, [field]: value }))
    }

    return (
        <form onSubmit={handleSubmit} className={`${CARD} space-y-4`}>
            {single && <BackToSettings />}
            <h2 className="text-lg font-bold">{title}</h2>

            {/* 個人資料 side by side: name on its own line, then two columns */}
            <div className="grid gap-4 @split:grid-cols-2">
                {fields.map((field) => (
                    <div key={field} className={field === 'displayName' || field === 'trainingGoal' || single ? '@split:col-span-2' : ''}>
                        <FieldEditor field={field} value={draft[field]} onChange={(v) => set(field, v)} hideLabel={single} isZhTW={isZhTW}
                            below={field === 'trainingGoal' && <GoalReadLine saved={values.trainingGoal} draft={draft.trainingGoal} state={goalRead} onRead={onReadGoal} weightUnit={values.weightUnit} language={values.language} />} />
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
                {status && (
                    <p role="status" className={`text-[15px] md:text-sm ${status.ok ? 'text-good' : 'text-miss'}`}>{status.text}</p>
                )}
                <button type="submit" disabled={saving} className={`${BUTTON.primary} ${single ? '@max-split:w-full' : ''}`}>
                    {saving ? t('saving') : t('save')}
                </button>
            </div>
        </form>
    )
}

/** One setting's control, with its label and what it is for (or, given below, what takes its place) */
function FieldEditor({ field, value, onChange, hideLabel, isZhTW, below }: {
    field: Field
    value: string
    onChange: (value: string) => void
    hideLabel: boolean
    isZhTW: boolean
    below?: React.ReactNode
}) {
    const t = useTranslations('settings')
    const id = `setting-${field}`
    const hint = field === 'weightUnit' || field === 'distanceUnit' || field === 'heightCm'
        ? t(`hints.${field}`)
        : null

    let control: React.ReactNode
    switch (field) {
        case 'displayName':
            control = <input id={id} type="text" value={value} maxLength={MAX_DISPLAY_NAME_CHARS} onChange={(e) => onChange(e.target.value)} placeholder={t('displayNamePlaceholder')} className={INPUT} />
            break
        case 'heightCm':
            control = <input id={id} type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} font-mono`} />
            break
        case 'dateOfBirth':
            control = <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} font-mono`} />
            break
        case 'sex':
            control = (
                <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
                    <option value="">{t('sexOptions.none')}</option>
                    <option value="male">{t('sexOptions.male')}</option>
                    <option value="female">{t('sexOptions.female')}</option>
                    <option value="other">{t('sexOptions.other')}</option>
                </select>
            )
            break
        case 'timezone': {
            const options = COMMON_TIMEZONES.includes(value) ? COMMON_TIMEZONES : [value, ...COMMON_TIMEZONES]
            control = (
                <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
                    {options.map((tz) => <option key={tz} value={tz}>{tz === CHOSEN_UTC ? 'UTC' : tz}</option>)}
                </select>
            )
            break
        }
        case 'trainingGoal':
            control = <textarea id={id} value={value} maxLength={MAX_TRAINING_GOAL_CHARS} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={t('trainingGoalPlaceholder')} className={TEXTAREA} />
            break
        case 'weightUnit':
            control = <Segmented id={id} options={['kg', 'lb']} value={value} onChange={onChange} />
            break
        case 'distanceUnit':
            control = <Segmented id={id} options={['km', 'mi']} value={value} onChange={onChange} />
            break
        case 'language':
            control = (
                <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
                    {Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
            )
            break
        case 'theme':
            control = <ThemeSelector isZhTW={isZhTW} value={value || 'system'} onChange={onChange} />
            break
    }

    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-[13px] font-medium text-muted md:text-xs'}>{t(`fields.${field}`)}</label>
            {control}
            {hint && <p className="text-[13px] text-muted md:text-xs">{hint}</p>}
            {below}
        </div>
    )
}

const NOTE = 'text-[13px] text-muted text-pretty md:text-xs'

/**
 * Under the goal: how to write one the report can track, then, once saved, the goal as read. A
 * saved goal not read yet (set in onboarding, or before reads were kept) is read when it is shown.
 * While the text is being changed, the read is of the old text, so the hint is shown instead.
 */
function GoalReadLine({ saved, draft, state, onRead, weightUnit, language }: {
    saved: string
    draft: string
    state: GoalReadState | null
    onRead: ReadGoal
    weightUnit: WeightUnit
    language: string
}) {
    const t = useTranslations('settings')
    const tGoal = useTranslations('reportV3.goal')
    const text = saved.trim()
    const shown = !!text && draft.trim() === text
    useEffect(() => {
        if (shown) onRead(text)
    }, [shown, text, onRead])
    const current = shown && state?.text === text ? state : null
    const labels = useGoalReadLabels({
        read: current?.read ?? null, zh: language === 'zh-TW', weightUnit,
        muscle: (g) => unitLabel(g, language, (x) => getMuscleGroupLabel(x, language)),
    })
    // Examples in the user's unit, the number kept on the line with it
    const lb = weightUnit === 'lb'
    const weight = (kg: number, pounds: number) => `${lb ? pounds : kg}\u00a0${weightUnit}`
    const lift = weight(80, 175)

    if (!current) return <p className={NOTE}>{t('hints.trainingGoal', { lift: weight(140, 300), weight: weight(75, 165) })}</p>
    if (current.status === 'reading') return <p role="status" className={NOTE}>{t('goalReading')}</p>
    if (current.status === 'failed' || !current.read) return <p role="status" className={NOTE}>{t('goalReadFailed')}</p>
    const { unread, targets } = current.read
    return (
        <div role="status" className="space-y-1.5">
            {labels.length > 0 && (
                <p className="flex flex-wrap items-center gap-1.5">
                    <span className={NOTE}>{t('goalRead')}</span>
                    {labels.map((label, i) => (
                        <span key={i} className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[13px] font-semibold text-accent first-letter:uppercase md:text-xs">{label}</span>
                    ))}
                </p>
            )}
            {unread ? <p className="text-[13px] text-miss text-pretty md:text-xs">{tGoal('unread', { text: unread })}</p>
                : !labels.length ? <p className={NOTE}>{t('goalReadNothing', { lift })}</p>
                : !targets.length ? <p className={NOTE}>{t('goalNoNumber', { lift })}</p>
                : null}
        </div>
    )
}

/** kg / lb, or km / mi */
function Segmented({ id, options, value, onChange }: { id: string; options: string[]; value: string; onChange: (v: string) => void }) {
    return (
        <div id={id} role="radiogroup" className={`${SEGMENTED.track} w-fit`}>
            {options.map((option) => (
                <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={value === option}
                    onClick={() => onChange(option)}
                    className={`${SEGMENTED.segment} min-w-16 font-mono`}
                >
                    {option}
                </button>
            ))}
        </div>
    )
}

/** How to put GymPro on the home screen, for the browser it is open in */
function InstallSteps({ showTitle = true }: { showTitle?: boolean }) {
    const t = useTranslations('settings')
    const zh = useLocale() === 'zh-TW'
    return (
        <div className="space-y-2">
            {showTitle && <p className="text-sm font-medium">{t('install')}</p>}
            <InstallGuide zh={zh} />
        </div>
    )
}

function OnboardingModalWrapper({
    userId,
    language,
    onClose,
}: {
    userId: string
    language: string
    onClose: () => void
}) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OnboardingModal } = require('@/components/OnboardingModal')
    return <OnboardingModal userId={userId} language={language} onClose={onClose} />
}
