'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import type { DayFacts, Finding, FollowUp, LiftFacts, ReportV3 } from '@/lib/report/types'
import { BodyMap } from './BodyMap'
import { Sparkline } from './Sparkline'

// The weekly report (version 3). The summary answers "how did it go, and what do I
// change"; the full analysis opens one section at a time. Every number and reason
// comes from code (report.facts, findings); only the headline and each action are
// the model's (report.narrative).

type Data = Finding['data']

const STATUS_COLOR: Record<ReportV3['facts']['status'], string> = {
    progressing: 'text-emerald-700 dark:text-emerald-400',
    stalling: 'text-ink/70 dark:text-white/70',
    regressing: 'text-amber-700 dark:text-amber-400',
    baseline: 'text-ink/70 dark:text-white/70',
}

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

export function ReportView({ report, language }: { report: ReportV3; language: string }) {
    const t = useTranslations('reportV3')
    const zh = language === 'zh-TW'
    const { facts, findings, watching, followUps, narrative } = report
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const [open, setOpen] = useState(false)
    // One section of the full analysis open at a time
    const [section, setSection] = useState<string | null>(null)
    const row = (id: string) => ({ open: section === id, onToggle: () => setSection(section === id ? null : id) })

    const muscle = (g: string) => getMuscleGroupLabel(g, language)
    const muscles = (list: string) => list.split(', ').filter(Boolean).map(muscle).join(zh ? '、' : ', ')
    const liftName = (x: { name: string; nameZh: string | null } | Data) => String((zh && x.nameZh) || x.name)
    const setText = (raw: unknown, bodyweight: unknown) => {
        if (raw == null) return '—'
        const [w, r] = String(raw).split('x')
        return Number(bodyweight) ? t('reps', { n: r }) : `${w}kg × ${r}`
    }
    const routineList = (s: unknown) => String(s ?? '').split(', ').join(zh ? '、' : ', ')

    const advised = (f: Finding | FollowUp) => t(`advised.${f.rule}`, { lift: liftName(f.data), muscle: muscle(String(f.subject ?? '')), unit })
    const why = (f: Finding) => {
        const d = f.data
        switch (f.rule) {
            case 'lift_stalled': return t('whyText.lift_stalled', { lift: liftName(d), n: Number(d.flatWindows), unit, best: setText(d.best, d.bodyweight) })
            case 'lift_regressed': return t('whyText.lift_regressed', { lift: liftName(d), previous: setText(d.previousBest, d.bodyweight), best: setText(d.best, d.bodyweight) })
            case 'deload': return t('whyText.deload', { lifts: String(zh ? d.liftsZh : d.lifts) })
            case 'low_volume': return t('whyText.low_volume', { muscle: muscle(String(f.subject)), perWeek: Number(d.perWeek) })
            case 'missed_sessions': {
                const base = t('whyText.missed_sessions', { planned: Number(d.planned), done: Number(d.done), routines: routineList(d.routines) })
                return d.lowGroups ? `${base}${zh ? '，' : '; '}${t('whyText.missedLow', { groups: muscles(String(d.lowGroups)) })}` : base
            }
            case 'weight_trend': return t('whyText.weight_trend', { direction: String(d.direction), n: Number(d.periods), unit })
        }
    }
    const result = (f: FollowUp) => {
        const d = f.data
        switch (f.rule) {
            case 'lift_stalled':
            case 'lift_regressed':
                return d.trained === 0 ? t('result.notTrained', { unit }) : t(`result.${f.rule}.${f.status}`, { now: setText(d.now, d.bodyweight) })
            case 'low_volume': return t(`result.low_volume.${f.status}`, { n: Number(d.nowPerWeek) })
            case 'missed_sessions': return t(`result.missed_sessions.${f.status}`, { done: Number(d.nowDone), planned: Number(d.nowPlanned), unit })
            case 'deload': return t(`result.deload.${f.status}`, { sets: Number(d.nowSets), unit })
            case 'weight_trend': return t(`result.weight_trend.${f.status}`, { kg: Number(d.nowKg) })
        }
    }

    const items = narrative.items.map((i) => ({ ...i, finding: findings.find((f) => f.id === i.findingId) })).filter((i) => i.finding)
    const missed = facts.sessions.planned != null ? facts.sessions.planned - facts.sessions.done : 0
    const lowGroups = facts.muscles.filter((m) => m.status === 'low').map((m) => m.group)
    const weightWatch = watching.find((w) => w.rule === 'weight_trend')
    const liftWatches = watching.filter((w) => w.rule === 'lift_stalled')

    return (
        <div className="space-y-5">
            {/* Status and headline */}
            <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink/50 dark:text-white/50">
                    {t('period', { unit, start: shortDate(facts.period.start), end: shortDate(facts.period.end) })}
                </p>
                <div className="flex flex-wrap items-baseline gap-x-3">
                    <h3 className={`text-2xl font-bold ${STATUS_COLOR[facts.status]}`}>{t(`status.${facts.status}`)}</h3>
                    <span className="text-sm font-medium text-ink/60 dark:text-white/60">{t(`statusHint.${facts.status}`, { unit })}</span>
                </div>
                <p className="text-[15px] leading-relaxed">{narrative.headline}</p>
            </div>

            {/* Four numbers, each against last period */}
            <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-ink/10 dark:border-white/10 [&>div:nth-child(2n)]:border-l [&>div:nth-child(n+3)]:border-t [&>div]:border-ink/10 dark:[&>div]:border-white/10">
                <Kpi label={t('kpi.sessions')} value={facts.sessions.planned != null ? <>{facts.sessions.done}<small className="text-base font-medium text-ink/40 dark:text-white/40"> / {facts.sessions.planned}</small></> : facts.sessions.done}
                    note={facts.sessions.planned != null ? (missed > 0 ? t('kpi.missed', { n: missed }) : t('kpi.allDone')) : null} />
                <Kpi label={t('kpi.records')} value={facts.records.length}
                    note={facts.records.length ? facts.records.slice(0, 2).map(liftName).join(zh ? '、' : ', ') : t('kpi.noRecords', { unit })} good={facts.records.length > 0} />
                <Kpi label={t('kpi.mainLifts')} value={<>{facts.liftsSummary.up}<small className="text-base font-medium text-ink/40 dark:text-white/40"> {t('kpi.up')}</small></>}
                    note={t('kpi.rest', { flat: facts.liftsSummary.flat, down: facts.liftsSummary.down })} />
                <Kpi label={t('kpi.weight')} value={facts.bodyWeight.latestKg != null ? <>{facts.bodyWeight.latestKg}<small className="text-base font-medium text-ink/40 dark:text-white/40"> kg</small></> : '—'}
                    note={facts.bodyWeight.changeKg != null ? t('kpi.weightChange', { unit, change: `${facts.bodyWeight.changeKg > 0 ? '+' : ''}${facts.bodyWeight.changeKg}` }) : facts.bodyWeight.latestKg == null ? t('kpi.noWeight') : null} />
            </dl>

            <WeekDots days={facts.sessions.days} zh={zh} />

            {/* Last report's advice, followed up */}
            {followUps.length > 0 && (
                <section className="space-y-2">
                    <SectionTitle title={t('followUpTitle')} count={t('followUpCount', { done: followUps.filter((f) => f.status === 'done').length, total: followUps.length })} />
                    <ul className="space-y-1.5">
                        {followUps.map((f) => (
                            <li key={f.id} className="grid grid-cols-[22px_1fr] gap-2 text-sm text-ink/70 dark:text-white/70">
                                <Mark status={f.status} />
                                <span><b className="font-semibold text-ink dark:text-white">{advised(f)}</b>{zh ? '：' : ': '}{result(f)}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* What to change next period */}
            <section className="space-y-2">
                <SectionTitle title={t('nextTitle', { unit })} count={items.length ? t('nextCount', { n: items.length }) : null} />
                {items.length === 0 ? (
                    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">{t('noAdvice', { unit })}</p>
                ) : (
                    <ol className="space-y-2.5">
                        {items.map((item, i) => (
                            <li key={item.findingId} className="space-y-2 rounded-xl border border-ink/10 p-3.5 dark:border-white/10">
                                <div className="grid grid-cols-[24px_1fr] items-start gap-2.5">
                                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-plate text-xs font-bold text-chalk dark:bg-chalk dark:text-plate">{i + 1}</span>
                                    <p className="font-semibold leading-relaxed">{item.action}</p>
                                </div>
                                <dl className="space-y-1 pl-[34px] text-[13px] text-ink/70 dark:text-white/70">
                                    <Reason tag={t('why')} tone="data">{why(item.finding!)}</Reason>
                                    <Reason tag={t('research')} tone="study">
                                        {t(`researchText.${item.finding!.rule}`)} <span className="text-xs text-ink/40 dark:text-white/40">· {t('researchPending')}</span>
                                    </Reason>
                                </dl>
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                className="w-full rounded-xl border border-plate py-3 text-sm font-bold hover:bg-ink/5 dark:border-chalk dark:hover:bg-white/5">
                {open ? `${t('showLess')} ▴` : `${t('readMore')} ▾`}
            </button>

            {open && (
                <div className="space-y-2">
                    <p className="text-xs text-ink/50 dark:text-white/50">{t('accordionHint')}</p>
                    <div className="divide-y divide-ink/10 rounded-xl border border-ink/10 dark:divide-white/10 dark:border-white/10">
                        <Row {...row('muscles')} title={t('section.muscles')} take={lowGroups.length ? t('section.musclesLow', { groups: lowGroups.map(muscle).join(zh ? '、' : ', ') }) : t('section.musclesOk')} tone={lowGroups.length ? 'warn' : 'good'}>
                            <BodyMap muscles={facts.muscles} frontLabel={t('front')} backLabel={t('back')} />
                            <Legend items={[['bg-emerald-500/80', t('legend.ok')], ['bg-amber-500/85', t('legend.low')], ['bg-sky-500/80', t('legend.high')], ['bg-ink/25 dark:bg-white/25', t('legend.none')]]} />
                            <p className="text-xs text-ink/50 dark:text-white/50">
                                {t('musclesNote', { sets: facts.totalSets.now, unit })} {facts.totalSets.previous != null && t('musclesNotePrev', { prev: facts.totalSets.previous, unit })}
                            </p>
                            <MuscleBars muscles={facts.muscles} label={muscle} />
                        </Row>
                        <Row {...row('lifts')} title={t('section.lifts')} take={facts.records.length ? t('section.recordsCount', { n: facts.records.length }) : null} tone="good">
                            {facts.records.length > 0 && (
                                <ul className="space-y-1.5">
                                    {facts.records.map((r) => (
                                        <li key={r.exerciseId} className="flex items-center gap-2.5 rounded-lg bg-[#C8955A]/15 px-3 py-2 text-sm">
                                            <span className="text-xs font-bold tracking-wider text-[#A8742F] dark:text-[#D9AA6E]">PR</span>
                                            <b className="flex-1 font-semibold">{liftName(r)} {r.bodyweight ? t('reps', { n: r.best.reps }) : `${r.best.weightKg}kg × ${r.best.reps}`}</b>
                                            <span className="text-xs text-ink/50 dark:text-white/50">{shortDate(r.date)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <LiftTable lifts={facts.lifts} name={liftName} set={(l) => setText(l.best ? `${l.best.weightKg}x${l.best.reps}` : null, l.bodyweight)}
                                prev={(l) => setText(l.previousBest ? `${l.previousBest.weightKg}x${l.previousBest.reps}` : null, l.bodyweight)}
                                trendLabel={(l) => t(`trend.${l.trend}`)}
                                trendNote={(l) => l.trend === 'flat' && l.flatWindows ? t('flatFor', { n: l.flatWindows, unit }) : l.change != null && l.trend !== 'new' ? (l.bodyweight ? `${l.change > 0 ? '+' : ''}${l.change}` : `${l.change > 0 ? '+' : ''}${l.change}%`) : null} />
                            <p className="text-xs text-ink/50 dark:text-white/50">{t('liftsNote', { unit })}</p>
                            {liftWatches.map((w) => <WatchNote key={w.subject} label={`${t('section.watching')}${zh ? '：' : ': '}`}>{t('liftWatch', { lift: liftName(w.data), n: Number(w.data.flatWindows), unit })}</WatchNote>)}
                        </Row>
                        <Row {...row('weight')} title={t('section.weight')} take={weightWatch ? t('section.watching') : facts.bodyWeight.latestKg == null ? t('section.noWeight') : null}>
                            {facts.bodyWeight.latestKg != null && (
                                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                                    <Sparkline values={facts.bodyWeight.series} width={220} height={56} className="w-full text-[#C8955A]" label={t('section.weight')} />
                                    <div className="text-right">
                                        <p className="text-2xl font-semibold tabular-nums">{facts.bodyWeight.latestKg}<small className="text-sm font-medium text-ink/40 dark:text-white/40"> kg</small></p>
                                        <p className="text-xs text-ink/50 dark:text-white/50">{t('weighIns', { n: facts.bodyWeight.weighIns, unit })}</p>
                                    </div>
                                </div>
                            )}
                            {weightWatch && <WatchNote label={`${t('section.watching')}${zh ? '：' : ': '}`}>{t('weightWatch', { direction: String(weightWatch.data.direction), n: Number(weightWatch.data.periods), needed: Number(weightWatch.data.needed), unit })}</WatchNote>}
                        </Row>
                        {findings.length > 0 && (
                            <Row {...row('basis')} title={t('section.basis')} take={String(findings.length)}>
                                {findings.map((f) => (
                                    <div key={f.id} className="space-y-1.5 rounded-lg border border-ink/10 p-3 text-[13px] dark:border-white/10">
                                        <h4 className="text-sm font-semibold">{advised(f)}</h4>
                                        <dl className="grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1">
                                            <dt className="text-ink/50 dark:text-white/50">{t('basisLabels.rule')}</dt><dd className="text-ink/70 dark:text-white/70">{t(`ruleText.${f.rule}`, { unit })}</dd>
                                            <dt className="text-ink/50 dark:text-white/50">{t('basisLabels.data')}</dt><dd className="text-ink/70 dark:text-white/70">{why(f)}</dd>
                                            <dt className="text-ink/50 dark:text-white/50">{t('basisLabels.research')}</dt><dd className="text-ink/70 dark:text-white/70">{t(`researchText.${f.rule}`)} <span className="text-xs text-ink/40 dark:text-white/40">· {t('researchPending')}</span></dd>
                                        </dl>
                                    </div>
                                ))}
                            </Row>
                        )}
                        <Row {...row('glossary')} title={t('section.glossary')} take={null}>
                            <dl className="space-y-2 text-[13px]">
                                {(['mainLifts', 'bestSet', 'e1rm', 'record', 'weeklySets', 'status'] as const).map((k) => (
                                    <div key={k}>
                                        <dt className="font-semibold">{t(`glossary.${k}.term`)}</dt>
                                        <dd className="text-ink/70 dark:text-white/70">{t(`glossary.${k}.text`, { unit })}</dd>
                                    </div>
                                ))}
                            </dl>
                        </Row>
                    </div>
                </div>
            )}
        </div>
    )
}

function Kpi({ label, value, note, good }: { label: string; value: React.ReactNode; note: string | null; good?: boolean }) {
    return (
        <div className="min-w-0 px-3.5 py-2.5">
            <dt className="text-xs text-ink/50 dark:text-white/50">{label}</dt>
            <dd className="text-[28px] font-semibold leading-tight tabular-nums">{value}</dd>
            {note && <dd className={`truncate text-xs ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink/60 dark:text-white/60'}`}>{note}</dd>}
        </div>
    )
}

const WEEKDAYS_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAYS_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function WeekDots({ days, zh }: { days: DayFacts[]; zh: boolean }) {
    return (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => {
                const missed = d.routine && !d.trained
                const weekday = new Date(`${d.date}T12:00:00Z`).getUTCDay()
                return (
                    <div key={d.date} title={d.routine ?? undefined} className="flex flex-col items-center gap-1 text-[11px] text-ink/50 dark:text-white/50">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${d.trained
                            ? 'bg-plate text-chalk dark:bg-chalk dark:text-plate'
                            : missed ? 'border-[1.5px] border-dashed border-amber-600 bg-amber-50 text-amber-700 dark:border-amber-400 dark:bg-amber-400/10 dark:text-amber-300'
                            : 'border border-ink/10 text-ink/40 dark:border-white/10 dark:text-white/40'}`}>
                            {/* Chinese routine names start differently (推、拉、腿); English ones don't (Push, Pull) */}
                            {zh && d.routine ? [...d.routine][0] : d.trained ? '✓' : missed ? '✕' : '–'}
                        </span>
                        <span>{(zh ? WEEKDAYS_ZH : WEEKDAYS_EN)[weekday]}</span>
                    </div>
                )
            })}
        </div>
    )
}

function SectionTitle({ title, count }: { title: string; count: string | null }) {
    return (
        <h4 className="flex items-baseline justify-between gap-2 text-[15px] font-bold">
            {title} {count && <span className="text-xs font-medium text-ink/50 dark:text-white/50">{count}</span>}
        </h4>
    )
}

function Mark({ status }: { status: FollowUp['status'] }) {
    const style = status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
        : status === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300'
        : 'bg-ink/10 text-ink/60 dark:bg-white/10 dark:text-white/60'
    return <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${style}`} aria-label={status}>{status === 'done' ? '✓' : status === 'partial' ? '△' : '✕'}</span>
}

function Reason({ tag, tone, children }: { tag: string; tone: 'data' | 'study'; children: React.ReactNode }) {
    const style = tone === 'data' ? 'bg-[#C8955A]/15 text-[#A8742F] dark:text-[#D9AA6E]' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
    return (
        <div className="grid grid-cols-[auto_1fr] items-baseline gap-2">
            <dt className={`whitespace-nowrap rounded-md px-1.5 text-[11px] font-bold ${style}`}>{tag}</dt>
            <dd>{children}</dd>
        </div>
    )
}

function Row({ title, take, tone, open, onToggle, children }: {
    title: string
    take: string | null
    tone?: 'good' | 'warn'
    open: boolean
    onToggle: () => void
    children: React.ReactNode
}) {
    const chip = tone === 'warn' ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300'
        : tone === 'good' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300'
        : 'bg-ink/5 text-ink/70 dark:bg-white/10 dark:text-white/70'
    return (
        <div>
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm font-bold">
                <span className="flex-1">{title}</span>
                {take && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${chip}`}>{take}</span>}
                <span className={`text-ink/40 transition-transform motion-reduce:transition-none dark:text-white/40 ${open ? 'rotate-180' : ''}`} aria-hidden>▾</span>
            </button>
            {open && <div className="space-y-3 px-3.5 pb-3.5">{children}</div>}
        </div>
    )
}

function Legend({ items }: { items: [string, string][] }) {
    return (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-ink/50 dark:text-white/50">
            {items.map(([color, label]) => <span key={label} className="flex items-center gap-1"><i className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />{label}</span>)}
        </div>
    )
}

const AXIS_MAX = 24
// Big groups with a weekly range first, then the ones without
const MUSCLE_ORDER = ['chest', 'back', 'shoulders', 'legs', 'glutes', 'biceps', 'triceps', 'core']

function MuscleBars({ muscles, label }: { muscles: ReportV3['facts']['muscles']; label: (g: string) => string }) {
    const pct = (v: number) => `${(Math.min(v, AXIS_MAX) / AXIS_MAX) * 100}%`
    return (
        <div className="space-y-2">
            {[...muscles].sort((a, b) => (MUSCLE_ORDER.indexOf(a.group) + 1 || 99) - (MUSCLE_ORDER.indexOf(b.group) + 1 || 99)).map((m) => (
                <div key={m.group} className="grid grid-cols-[40px_1fr_56px] items-center gap-2 text-[13px]" role="img" aria-label={`${label(m.group)} ${m.perWeek}`}>
                    <span className="text-ink/70 dark:text-white/70">{label(m.group)}</span>
                    <div className="relative h-3.5 overflow-hidden rounded bg-ink/10 dark:bg-white/10">
                        {m.status !== 'no_target' && <div className="absolute inset-y-0 border-x border-dashed border-[#C8955A] bg-[#C8955A]/20" style={{ left: pct(10), width: pct(10) }} />}
                        <div className={`absolute inset-y-[3px] left-0 rounded-sm ${m.status === 'low' ? 'bg-amber-600 dark:bg-amber-400' : 'bg-ink dark:bg-white'}`} style={{ width: pct(m.perWeek) }} />
                    </div>
                    <span className={`text-right font-semibold tabular-nums ${m.status === 'low' ? 'text-amber-700 dark:text-amber-400' : ''}`}>{m.perWeek}</span>
                </div>
            ))}
            <div className="grid grid-cols-[40px_1fr_56px] gap-2 text-[10px] text-ink/40 dark:text-white/40">
                <span />
                <div className="relative h-3">{[0, 10, 20].map((v) => <span key={v} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(v) }}>{v}</span>)}</div>
                <span />
            </div>
        </div>
    )
}

function LiftTable({ lifts, name, set, prev, trendLabel, trendNote }: {
    lifts: LiftFacts[]
    name: (l: LiftFacts) => string
    set: (l: LiftFacts) => string
    prev: (l: LiftFacts) => string
    trendLabel: (l: LiftFacts) => string
    trendNote: (l: LiftFacts) => string | null
}) {
    const color = (l: LiftFacts) => l.trend === 'up' ? 'text-emerald-700 dark:text-emerald-400' : l.trend === 'down' ? 'text-amber-700 dark:text-amber-400' : 'text-ink/60 dark:text-white/60'
    return (
        <div className="divide-y divide-ink/10 rounded-lg border border-ink/10 dark:divide-white/10 dark:border-white/10">
            {lifts.map((l) => (
                <div key={l.exerciseId} className="grid grid-cols-[1fr_auto_76px] items-center gap-2.5 px-3 py-2">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{name(l)}</p>
                        <p className="text-[13px] tabular-nums text-ink/60 dark:text-white/60">{prev(l)} → {set(l)}</p>
                    </div>
                    <p className={`text-right text-xs font-bold ${color(l)}`}>
                        {trendLabel(l)}
                        {trendNote(l) && <small className="block text-[11px] font-medium text-ink/50 dark:text-white/50">{trendNote(l)}</small>}
                    </p>
                    <Sparkline values={l.series} className={color(l)} label={name(l)} />
                </div>
            ))}
        </div>
    )
}

function WatchNote({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <p className="border-l-[3px] border-ink/15 pl-2.5 text-[13px] text-ink/70 dark:border-white/15 dark:text-white/70">
            <b className="font-semibold">{label}</b>{children}
        </p>
    )
}

export function isReportV3(rec: unknown): rec is ReportV3 {
    return !!rec && typeof rec === 'object' && (rec as { version?: unknown }).version === 3
}

