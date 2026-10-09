import { getLocale, getTranslations } from 'next-intl/server'
import { MUSCLE_GROUP_LABELS } from '@/lib/exercise-display'

// Stylized pieces of the app for the welcome page, drawn with the app's own styles
// and strings. The content is made up for illustration; each one is a single
// labelled image for screen readers, so the fake text inside isn't read out.

const ACCENT = '#C8955A'

// Ronnie's chat window, as in RonnieWidget: a swap in today's workout, then a routine
// change that waits for the user's OK
export async function RonnieChatMock() {
    const t = await getTranslations('welcome.chat')

    return (
        <div role="img" aria-label={t('label')}
            className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-2xl">
            <div className="flex items-center gap-3 bg-[#26241F] px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: ACCENT }}>
                    R
                </span>
                <div>
                    <p className="text-sm font-semibold text-white">Ronnie</p>
                    <p className="text-xs text-white/60">{t('subtitle')}</p>
                </div>
            </div>

            <div className="space-y-3 p-4 text-sm leading-relaxed">
                <div className="flex justify-end motion-safe:animate-rise">
                    <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-plate px-3 py-2 text-chalk dark:bg-white dark:text-[#1A1814]">
                        {t('user')}
                    </p>
                </div>
                <RonnieBubble delay={300}>{t('reply')}</RonnieBubble>
                {/* The swap card as the app draws it: nothing changes until the user taps Swap */}
                <div className="ml-8 flex items-center justify-between gap-2 rounded-xl border border-ink/10 p-3 text-xs motion-safe:animate-rise"
                    style={{ animationDelay: '600ms' }}>
                    <span>🔄 {t('swapCard')}</span>
                    <span className="shrink-0 rounded-lg px-3 py-1 font-semibold text-[#1A1814]" style={{ backgroundColor: ACCENT }}>
                        {t('swap')}
                    </span>
                </div>
                <p className="text-center text-xs text-ink/50 motion-safe:animate-rise" style={{ animationDelay: '900ms' }}>
                    {t('swapped')}
                </p>
            </div>

            <div className="border-t border-ink/10 p-3">
                <p className="rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink/50">{t('placeholder')}</p>
            </div>
        </div>
    )
}

function RonnieBubble({ delay, children }: { delay: number; children: React.ReactNode }) {
    return (
        <div className="flex items-start motion-safe:animate-rise" style={{ animationDelay: `${delay}ms` }}>
            <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: ACCENT }}>
                R
            </span>
            <p className="max-w-[85%] rounded-2xl rounded-tl-sm bg-ink/5 px-3 py-2">{children}</p>
        </div>
    )
}

// A four-day training cycle with today highlighted
export async function CycleMock() {
    const [t, tToday, tRoutines] = await Promise.all([
        getTranslations('welcome.mock'),
        getTranslations('today'),
        getTranslations('routines'),
    ])
    const days = [t('push'), t('pull'), t('legs'), tRoutines('restDay')]
    const today = 3

    return (
        <div role="img" aria-label={t('planLabel')} className="space-y-2 rounded-xl bg-ink/[0.03] p-3">
            <div className="grid grid-cols-4 gap-1.5">
                {days.map((name, i) => {
                    const isToday = i + 1 === today
                    return (
                        <div key={i}
                            className={`rounded-lg px-1 py-2 text-center ${isToday
                                ? 'bg-plate text-chalk dark:bg-white dark:text-[#1A1814]'
                                : 'border border-ink/10 bg-white'
                                }`}>
                            <p className={`text-[11px] ${isToday ? 'font-semibold' : 'text-ink/50'}`}>
                                {isToday ? tToday('title') : t('day', { n: i + 1 })}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold leading-tight">{name}</p>
                        </div>
                    )
                })}
            </div>
            <p className="text-xs text-ink/60">{tToday('dayOf', { day: today, total: days.length })}</p>
        </div>
    )
}

// One exercise on the Today card: logged sets as chips, then the next set's inputs
export async function LogMock() {
    const [t, tToday, locale] = await Promise.all([
        getTranslations('welcome.mock'),
        getTranslations('today'),
        getLocale(),
    ])
    const groups = MUSCLE_GROUP_LABELS[locale] ?? MUSCLE_GROUP_LABELS.en

    return (
        <div role="img" aria-label={t('logLabel')} className="space-y-2 rounded-xl bg-ink/[0.03] p-3">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink/50">{groups.legs}</p>
                    <p className="text-sm font-medium">{t('legPress')}</p>
                </div>
                <div className="flex overflow-hidden rounded-lg border border-ink/20 text-[11px] font-bold">
                    <span className="bg-plate px-2.5 py-1 text-chalk dark:bg-white dark:text-[#1A1814]">kg</span>
                    <span className="px-2.5 py-1 text-ink/40">lb</span>
                </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {['10×100kg', '10×100kg', '8×100kg'].map((set, i) => (
                    <span key={i} className="rounded-full bg-plate/10 px-2.5 py-1 font-mono text-[11px]">{set}</span>
                ))}
            </div>
            <div className="flex gap-1.5 text-xs">
                <span className="w-16 rounded-md border border-ink/20 px-2 py-1 text-ink/40">{tToday('reps')}</span>
                <span className="w-16 rounded-md border border-ink/20 px-2 py-1 text-ink/40">kg</span>
                <span className="rounded-md border border-ink/20 px-3 py-1">{tToday('add')}</span>
            </div>
        </div>
    )
}

// Asking Ronnie in plain words and getting a recommendation card back
export async function AskMock() {
    const t = await getTranslations('welcome.mock')

    return (
        <div role="img" aria-label={t('askLabel')} className="space-y-2 rounded-xl bg-ink/[0.03] p-3">
            <div className="flex justify-end">
                <p className="rounded-2xl rounded-tr-sm bg-plate px-3 py-1.5 text-xs text-chalk dark:bg-white dark:text-[#1A1814]">
                    {t('askQuestion')}
                </p>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-ink/10 bg-white p-2.5 text-xs">
                <span className="min-w-0">💡 {t('askExercise')}</span>
                <span className="shrink-0 rounded-md px-2.5 py-1 font-semibold text-[#1A1814]" style={{ backgroundColor: ACCENT }}>
                    {t('addToday')}
                </span>
            </div>
        </div>
    )
}

// The top of an AI Coach Report: training split and strength trend
export async function ReportMock() {
    const [t, tReport, locale] = await Promise.all([
        getTranslations('welcome.mock'),
        getTranslations('report'),
        getLocale(),
    ])
    const groups = MUSCLE_GROUP_LABELS[locale] ?? MUSCLE_GROUP_LABELS.en
    const split = [
        { label: groups.legs, width: '32%', color: 'bg-[#C8955A]' },
        { label: groups.back, width: '28%', color: 'bg-ink/70' },
        { label: groups.chest, width: '24%', color: 'bg-ink/40' },
        { label: groups.shoulders, width: '16%', color: 'bg-ink/15' },
    ]

    return (
        <div role="img" aria-label={t('reviewLabel')} className="space-y-3 rounded-xl bg-ink/[0.03] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/60">{tReport('sectionTitle')}</p>
            <div className="space-y-1.5">
                <p className="text-xs text-ink/60">{tReport('trainingSplit')}</p>
                <div className="flex h-2.5 overflow-hidden rounded-full">
                    {split.map((s) => (
                        <span key={s.label} className={s.color} style={{ width: s.width }} />
                    ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink/60">
                    {split.map((s) => (
                        <span key={s.label} className="inline-flex items-center gap-1">
                            <span className={`h-2 w-2 rounded-full ${s.color}`} />
                            {s.label}
                        </span>
                    ))}
                </div>
            </div>
            <div className="space-y-1">
                <p className="text-xs text-ink/60">{tReport('strengthTrend')}</p>
                <svg viewBox="0 0 200 48" className="h-12 w-full text-ink" preserveAspectRatio="none">
                    <line x1="0" y1="38" x2="200" y2="38" stroke="currentColor" strokeOpacity="0.2"
                        strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                    <polyline points="0,38 40,35 80,36 120,27 160,22 200,12" fill="none" stroke={ACCENT}
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
            </div>
        </div>
    )
}
