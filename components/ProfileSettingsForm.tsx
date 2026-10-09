'use client'

import { useState, useSyncExternalStore } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { setLanguageCookie } from '@/lib/set-language-cookie'
import type { WeightUnit } from '@/lib/weight-unit'
import type { DistanceUnit } from '@/lib/distance-unit'
import { closeSubPage, openSubPage } from '@/lib/sub-page'
import type { Database } from '@/lib/types/database.types'
import { DeleteAccountButton } from '@/components/DeleteAccountButton'
import { LogoutButton } from '@/components/LogoutButton'
import { ThemeSelector } from '@/components/ThemeSelector'
import { Icon } from '@/components/Icon'

// Settings. Side by side (@split): the sections on the left (個人資料, 訓練目標, 單位與語言,
// 外觀, 帳號), the chosen section's form on the right. On a phone: one grouped list with
// each setting's current value; a setting opens as a page of its own (?item=, see
// lib/sub-page.ts) with its own save button.

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

/** The profile plus the theme, which lives in the browser (next-themes), not the database */
type Values = ProfileValues & { theme: string }
type Field = keyof Values
type Section = 'profile' | 'goal' | 'units' | 'appearance' | 'account'
/** What a phone row opens: a setting, or the add-to-home-screen steps */
type Item = Field | 'install'

const SECTIONS: { key: Section; fields: Field[] }[] = [
    { key: 'profile', fields: ['displayName', 'heightCm', 'dateOfBirth', 'sex', 'timezone'] },
    { key: 'goal', fields: ['trainingGoal'] },
    { key: 'units', fields: ['weightUnit', 'distanceUnit', 'language'] },
    { key: 'appearance', fields: ['theme'] },
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
const isItem = (s: string | null): s is Item => s === 'install' || FIELDS.includes(s as Field)

const COMMON_TIMEZONES = [
    'UTC',
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

const CARD = 'rounded-[14px] border border-line bg-card p-4'
const INPUT = 'w-full rounded-[9px] border border-line bg-card px-3 py-2'
const PRIMARY = 'inline-flex min-h-10 items-center justify-center rounded-[9px] bg-accent px-5 text-sm font-bold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50'
const ROW = 'flex min-h-12 w-full items-center gap-3 py-2.5 text-left'

// The theme is only known in the browser: the server and the first render show none
const subscribeNothing = () => () => {}

export function ProfileSettingsForm({ userId, initial }: { userId: string; initial: ProfileValues }) {
    const t = useTranslations('settings')
    const router = useRouter()
    const searchParams = useSearchParams()
    const { theme, setTheme } = useTheme()
    const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false)
    const [saved, setSaved] = useState<ProfileValues>(initial)
    const [section, setSection] = useState<Section>('profile')
    const [showOnboarding, setShowOnboarding] = useState(false)

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
            if (error) return t('saveFailed', { message: error.message })
        }

        const profileChanges = { ...changes }
        delete profileChanges.theme
        setSaved((prev) => ({ ...prev, ...profileChanges }))
        if (changes.language !== undefined && changes.language !== saved.language) {
            // The page's own text is in the old language until it is drawn again
            await setLanguageCookie(changes.language)
            router.refresh()
        }
        return null
    }

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
            <li>
                <LogoutButton className={`${ROW} justify-between`} />
            </li>
            <li>
                <DeleteAccountButton isZhTW={isZhTW} className={`${ROW} font-bold text-miss`} />
            </li>
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
                            className={`block w-full rounded-[9px] px-3 py-2 text-left text-sm font-medium ${section === key ? 'bg-done text-ink' : 'text-muted hover:text-ink'}`}
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
                    ) : (
                        <SettingsForm
                            key={section}
                            title={t(`sections.${section}`)}
                            fields={SECTIONS.find((s) => s.key === section)!.fields}
                            values={values}
                            onSave={save}
                            isZhTW={isZhTW}
                        />
                    )}
                </div>

                {/* Phone: every setting, grouped, with its value */}
                <div className={`space-y-4 @split:hidden ${item ? 'hidden' : ''}`}>
                    {PHONE_GROUPS.map(({ key, fields }) => (
                        <section key={key} className="space-y-1.5">
                            <h2 className="px-1 text-xs tracking-wider text-faint">{t(`groups.${key}`)}</h2>
                            <ul className="divide-y divide-line rounded-[14px] border border-line bg-card px-3">
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
                        ) : (
                            <SettingsForm key={item} title={t(`fields.${item}`)} fields={[item]} values={values} onSave={save} isZhTW={isZhTW} single />
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
    /** One setting on its own page: the title is its label */
    single?: boolean
}

/** A section's settings, or a single one, with a save button */
function SettingsForm({ title, fields, values, onSave, isZhTW, single = false }: SettingsFormProps) {
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
                        <FieldEditor field={field} value={draft[field]} onChange={(v) => set(field, v)} hideLabel={single} isZhTW={isZhTW} />
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
                {status && (
                    <p role="status" className={`text-sm ${status.ok ? 'text-good' : 'text-miss'}`}>{status.text}</p>
                )}
                <button type="submit" disabled={saving} className={`${PRIMARY} ${single ? '@max-split:w-full' : ''}`}>
                    {saving ? t('saving') : t('save')}
                </button>
            </div>
        </form>
    )
}

/** One setting's control, with its label and what it is for */
function FieldEditor({ field, value, onChange, hideLabel, isZhTW }: {
    field: Field
    value: string
    onChange: (value: string) => void
    hideLabel: boolean
    isZhTW: boolean
}) {
    const t = useTranslations('settings')
    const id = `setting-${field}`
    const hint = field === 'weightUnit' || field === 'distanceUnit' || field === 'trainingGoal' || field === 'heightCm'
        ? t(`hints.${field}`)
        : null

    let control: React.ReactNode
    switch (field) {
        case 'displayName':
            control = <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('displayNamePlaceholder')} className={INPUT} />
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
                    {options.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
            )
            break
        }
        case 'trainingGoal':
            control = <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={t('trainingGoalPlaceholder')} className={INPUT} />
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
            <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-xs font-medium text-muted'}>{t(`fields.${field}`)}</label>
            {control}
            {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
    )
}

/** kg / lb, or km / mi */
function Segmented({ id, options, value, onChange }: { id: string; options: string[]; value: string; onChange: (v: string) => void }) {
    return (
        <div id={id} role="radiogroup" className="inline-flex overflow-hidden rounded-[9px] border border-line">
            {options.map((option) => (
                <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={value === option}
                    onClick={() => onChange(option)}
                    className={`min-h-10 min-w-16 px-4 font-mono text-sm font-bold ${value === option ? 'bg-ink text-card' : 'text-faint'}`}
                >
                    {option}
                </button>
            ))}
        </div>
    )
}

/** How to put GymPro on an iPhone's home screen */
function InstallSteps({ showTitle = true }: { showTitle?: boolean }) {
    const t = useTranslations('settings')
    return (
        <div className="space-y-2">
            {showTitle && <p className="text-sm font-medium">{t('install')}</p>}
            <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
                <li>{t('installSteps.share')}</li>
                <li>{t('installSteps.add')}</li>
                <li>{t('installSteps.done')}</li>
            </ol>
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
