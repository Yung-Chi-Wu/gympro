'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { JOINT_LABELS, type Joint } from '@/lib/exercise-attributes'
import { getMuscleGroupLabel } from '@/lib/exercise-display'
import { unitLabel } from '@/lib/report/volume'
import { toDisplayWeight, type WeightUnit } from '@/lib/weight-unit'
import { toDisplayDistance, toDisplaySpeed, type DistanceUnit } from '@/lib/distance-unit'
import { CARDIO_EVIDENCE, EVIDENCE, GLOSSARY_SOURCES, GOAL_EVIDENCE, MIN_EFFECTIVE_WEEKLY_SETS, PLAN_EVIDENCE, type PlanPart, type Source } from '@/lib/report/evidence'
import { CODE_RULES, type BestSet, type CardioFacts, type CardioTrendFacts, type ContextNote, type DayFacts, type Finding, type FollowUp, type LiftFacts, type ReportFacts, type ReportV3, type WeekSignal } from '@/lib/report/types'
import { BodyMap } from './BodyMap'
import { Sparkline } from './Sparkline'

// The weekly report (version 3). Every number and reason comes from code (report.facts,
// findings); only the headline and each action are the model's (report.narrative).
//   summary  on Today: how it went and what to change, each piece of advice in one line,
//            then a link to the full report in History. A dashboard is read at a glance:
//            expanded on Today the report ran several screens down a narrow column (the
//            owner, 2026-10-13), and none of the apps compared puts a whole report on Home.
//   full     in History: the advice with its reasons and research, then the analysis
//            sections, one open at a time (one level, not a button and then the sections).
//
// On a phone (below md) the report sits in one card, so nothing inside it is a box of its
// own: groups are set apart by lines and space, and text is at least 12-13px. The max-md:
// classes do that; from md the report looks as it did.

type Data = Finding['data']
/** Items the summary shows; the full report shows all */
const SUMMARY_ITEMS = 3
/** Where a plan's reason comes from (reportV3.sourceTag) */
type SourceTag = 'goal' | 'log' | 'memory' | 'week'

const STATUS_COLOR: Record<ReportV3['facts']['status'], string> = {
    progressing: 'text-emerald-700 dark:text-emerald-400',
    stalling: 'text-ink/70 dark:text-white/70',
    regressing: 'text-amber-700 dark:text-amber-400',
    baseline: 'text-ink/70 dark:text-white/70',
}

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

export function ReportView({ report, language, weightUnit, distanceUnit = 'km', variant = 'full', fullHref }: {
    report: ReportV3
    language: string
    weightUnit: WeightUnit
    distanceUnit?: DistanceUnit
    variant?: 'summary' | 'full'
    /** summary: where the full report is (History, with this report open) */
    fullHref?: string
}) {
    const t = useTranslations('reportV3')
    const zh = language === 'zh-TW'
    const { facts, findings, watching, followUps, narrative } = report
    const unit = facts.period.days === 7 ? 'week' : 'cycle'
    const summary = variant === 'summary'
    // One section of the full analysis open at a time
    const [section, setSection] = useState<string | null>(null)
    const row = (id: string) => ({ open: section === id, onToggle: () => setSection(section === id ? null : id) })

    // Volume units (side delts, quads...); reports saved before the split name categories
    const muscle = (g: string) => unitLabel(g, language, (x) => getMuscleGroupLabel(x, language))
    const muscles = (list: string) => list.split(', ').filter(Boolean).map(muscle).join(zh ? '、' : ', ')
    const liftName = (x: { name: string; nameZh: string | null } | Data) => String((zh && x.nameZh) || x.name)
    // Weights are stored in kg and shown in the user's unit
    const weight = (kg: number) => `${toDisplayWeight(kg, weightUnit)}${weightUnit}`
    /** Weight on top of the body, or the reps alone when there was none */
    const addedText = (kg: number, reps: number | string) => (kg === 0 ? t('reps', { n: reps }) : `+${weight(kg)} × ${reps}`)
    /** A set in finding data ("82.5x8"); its flags say to read only the reps, the number as the assist, or as weight added to the body */
    const setText = (raw: unknown, d: { bodyweight?: unknown; assisted?: unknown; added?: unknown }) => {
        if (raw == null) return '—'
        const [w, r] = String(raw).split('x')
        return Number(d.assisted) ? t('assisted', { n: r, assist: weight(Number(w)) }) : Number(d.added) ? addedText(Number(w), r)
            : Number(d.bodyweight) ? t('reps', { n: r }) : `${weight(Number(w))} × ${r}`
    }
    const bestText = (s: BestSet | null, kind: { bodyweight: boolean; added?: boolean }) =>
        !s ? '—' : s.assistKg != null ? t('assisted', { n: s.reps, assist: weight(s.assistKg) }) : kind.added ? addedText(s.weightKg, s.reps)
            : kind.bodyweight ? t('reps', { n: s.reps }) : `${weight(s.weightKg)} × ${s.reps}`
    const bodyWeight = (kg: number) => toDisplayWeight(kg, weightUnit)
    const routineList = (s: unknown) => String(s ?? '').split(', ').join(zh ? '、' : ', ')

    const advised = (f: Finding | FollowUp) => t(`advised.${f.rule}`, { lift: liftName(f.data), muscle: muscle(String(f.subject ?? '')), unit })
    // A plan's set read the way its lift is logged: the assist, the reps alone, or weight x reps
    const planFlags = (d: Data) => ({ assisted: d.how === 'assist' ? 1 : 0, bodyweight: d.how === 'reps' ? 1 : 0 })
    const planSet = (d: Data) => setText(`${d.how === 'assist' ? d.assistKg : d.weightKg}x${d.low}`, planFlags(d))
    /** Where each part of a reason comes from, shown before it as a tag: the goal, the log, Ronnie's notes, what was said this period */
    const tagged = (parts: [SourceTag, string][]): React.ReactNode => parts.map(([tag, text], i) => (
        <span key={i}>{i > 0 && ' · '}<span className="mr-1 rounded bg-ink/5 px-1 text-[11px] font-bold text-ink/60 max-md:text-xs dark:bg-white/10 dark:text-white/60">{t(`sourceTag.${tag}`, { unit })}</span>{text}</span>
    ))
    const said = (d: Data, key: 'pain' | 'tired') =>
        t('whyText.said', { date: shortDate(String(d[`${key}Date`])), source: String(d[`${key}Source`]), text: String(d[key === 'pain' ? 'painText' : 'tired']) })
    const planWhy = (f: Finding): React.ReactNode => {
        const d = f.data
        const parts: [SourceTag, string][] = []
        if (f.rule === 'pain_hold') parts.push(['week', said(d, 'pain')])
        if (f.rule === 'few_days') parts.push(['log', t('whyText.few_days', { n: Number(d.days), perWeek: Number(d.perWeek), unit })])
        if (f.rule === 'next_session') parts.push(['log', `${liftName(d)}${zh ? '：' : ': '}${t('whyText.next_session', { set: planSet(d) })}`])
        if (f.rule === 'goal_path') {
            if (d.path === 'pulldown') parts.push(['log', t('whyText.goalPulldown', { via: liftName({ name: String(d.viaName), nameZh: d.viaNameZh }), e1rm: weight(Number(d.proxyE1rmKg)), checkpoint: weight(Math.round(Number(d.checkpointKg))) })])
            else if (d.path === 'start') parts.push(['log', t('whyText.goalStart', { lift: liftName(d) })])
            else if (d.path === 'not_trained' || d.path === 'find_weight') parts.push(['log', t('whyText.goalNotTrained', { unit })])
            else if (d.share != null && d.e1rmKg != null) parts.push(['goal', t('whyText.goal_path', { unit, best: planSet(d), e1rm: weight(Number(d.e1rmKg)), share: Math.round(Number(d.share) * 100) })])
            else parts.push(['log', t('whyText.goalNoShare', { unit, best: planSet(d) })])
            if (String(d.options ?? '').includes('second_day')) parts.push(['log', t('whyText.goalOnce', { unit })])
            if (d.injury) parts.push(['memory', t('whyText.goalInjury', { text: String(d.injury), date: shortDate(String(d.injuryDate)) })])
            if (d.dislike) parts.push(['memory', t('whyText.goalDislike', { text: String(d.dislike), date: shortDate(String(d.dislikeDate)) })])
        }
        return tagged(parts)
    }
    /** The research behind a plan: each part it uses, with its papers; holding a lift for pain is a safety rule with none */
    const planParts = (f: Finding): PlanPart[] => (f.rule === 'pain_hold' || f.rule === 'few_days' ? [] : (f.rule === 'goal_path' ? String(f.data.research ?? 'progress').split(',').filter(Boolean) : ['progress']) as PlanPart[])
    const planResearch = (f: Finding): [string, Source[], PlanPart | null][] => {
        if (f.rule === 'pain_hold' || f.rule === 'few_days') return [[t(`researchText.${f.rule}`), EVIDENCE[f.rule].sources, null]]
        return planParts(f).map((p) => [t(`planResearch.${p}`), PLAN_EVIDENCE[p], p])
    }
    const why = (f: Finding): React.ReactNode => {
        const d = f.data
        switch (f.rule) {
            case 'goal_path':
            case 'next_session':
            case 'pain_hold':
            case 'few_days':
                return planWhy(f)
            case 'lift_stalled': return t('whyText.lift_stalled', { lift: liftName(d), n: Number(d.flatWindows), unit, best: setText(d.best, d) })
            case 'lift_regressed': return t('whyText.lift_regressed', { lift: liftName(d), previous: setText(d.previousBest, d), best: setText(d.best, d) })
            // What the user said, when they said they were tired: the deload rests on it
            case 'deload': {
                const base = t(Number(d.count) === 1 ? 'whyText.deloadOne' : 'whyText.deload', { lifts: String(zh ? d.liftsZh : d.lifts) })
                return d.tired ? tagged([['log', base], ['week', said(d, 'tired')]]) : base
            }
            // Below the minimum effective dose it says so, which is a stronger reason than "under 10"
            case 'low_volume': return t('whyText.low_volume', { muscle: muscle(String(f.subject)), perWeek: Number(d.perWeek), level: Number(d.perWeek) < MIN_EFFECTIVE_WEEKLY_SETS ? 'below' : 'other' })
            case 'missed_sessions': {
                const base = t('whyText.missed_sessions', { planned: Number(d.planned), done: Number(d.done), routines: routineList(d.routines) })
                const more = [d.lowGroups && t('whyText.missedLow', { groups: muscles(String(d.lowGroups)) }), d.shrink && t('whyText.missedShrink', { unit })].filter(Boolean)
                return [base, ...more].join(zh ? '，' : '; ')
            }
            case 'weight_trend': return t('whyText.weight_trend', { direction: String(d.direction), n: Number(d.periods), unit })
            case 'cardio_first': {
                const day = `${shortDate(String(d.date))}${d.routine ? ` ${d.routine}` : ''}`
                const base = t('whyText.cardio_first', { day, minutes: Number(d.minutes), cardio: String((zh && d.cardioZh) || d.cardio), lift: String((zh && d.liftZh) || d.lift) })
                if (Number(d.sessions) < 2) return base
                const dates = String(d.dates).split(', ').map(shortDate).join(zh ? '、' : ', ')
                return `${base}${zh ? '；' : '; '}${t('whyText.cardioFirstMore', { n: Number(d.sessions), dates, unit })}`
            }
        }
    }
    const result = (f: FollowUp) => {
        const d = f.data
        switch (f.rule) {
            case 'lift_stalled':
            case 'lift_regressed':
                return d.trained === 0 ? t('result.notTrained', { unit }) : t(`result.${f.rule}.${f.status}`, { now: setText(d.now, d) })
            case 'goal_path':
            case 'next_session':
            case 'pain_hold':
                return d.trained === 0 ? t('result.notTrained', { unit }) : t(`result.${f.rule === 'pain_hold' ? 'next_session' : f.rule}.${f.status}`, { now: setText(d.now, planFlags(d)) })
            case 'low_volume': return t(`result.low_volume.${f.status}`, { n: Number(d.nowPerWeek) })
            case 'missed_sessions':
                // No cycle any more, so nothing planned to count against
                return d.noPlan ? t('result.missed_sessions.noPlan', { done: Number(d.nowDone), unit }) : t(`result.missed_sessions.${f.status}`, { done: Number(d.nowDone), planned: Number(d.nowPlanned), unit })
            case 'deload': return t(`result.deload.${f.status}`, { sets: Number(d.nowSets), unit })
            case 'few_days': return t(`result.few_days.${f.status}`, { n: Number(d.nowDays), unit })
            case 'weight_trend':
                return d.weighIns === 0 ? t('result.weight_trend.noWeighIn', { unit }) : t(`result.weight_trend.${f.status}`, { kg: bodyWeight(Number(d.nowKg)), unit: weightUnit })
            case 'cardio_first':
                return d.legSessions === 0 ? t('result.cardio_first.noLegs', { unit }) : t(`result.cardio_first.${f.status}`, { n: Number(d.legSessions), still: Number(d.stillFirst), unit })
        }
    }

    // One item per fired rule, with every finding of it; reports saved before that have one per finding
    const items = narrative.items
        .map((i) => ({ ...i, findings: findings.filter((f) => (i.rule ? f.rule === i.rule : f.id === i.findingId)) }))
        .filter((i) => i.findings.length)
    // The summary shows the first 3, the most important (owner, 2026-10-20); the rest are in the full report
    const shownItems = summary ? items.slice(0, SUMMARY_ITEMS) : items
    /** Whether an earlier item already showed this research part in full */
    const researchSeen = (index: number, part: PlanPart | null) => !!part && shownItems.slice(0, index).some((x) => CODE_RULES.has(x.findings[0].rule) && planParts(x.findings[0]).includes(part))
    const missed = facts.sessions.planned != null ? facts.sessions.planned - facts.sessions.done : 0
    const lowGroups = facts.muscles.filter((m) => m.status === 'low').map((m) => m.group)
    const weightWatch = watching.find((w) => w.rule === 'weight_trend')
    // Shown when there was cardio this period or the one before; reports saved before cardio was read have none
    const cardio = facts.cardio && (facts.cardio.minutes > 0 || !!facts.cardio.previousPerWeek) ? facts.cardio : null
    const liftWatches = watching.filter((w) => w.rule === 'lift_stalled')
    // A lighter week's numbers are lines under the deload, which gives the reason for them
    const basis = findings.filter((f) => f.data.how !== 'deload')

    return (
        <div className="space-y-5">
            {/* Status and headline */}
            <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink/50 max-md:text-[13px] dark:text-white/50">
                    {t('period', { unit, start: shortDate(facts.period.start), end: shortDate(facts.period.end) })}
                </p>
                <div className="flex flex-wrap items-baseline gap-x-3">
                    <h3 className={`text-2xl font-bold ${STATUS_COLOR[facts.status]}`}>{t(`status.${facts.status}`)}</h3>
                    <span className="text-sm font-medium text-ink/60 max-md:text-[15px] dark:text-white/60">{t(`statusHint.${facts.status}`, { unit })}</span>
                </div>
                <p className="text-[15px] leading-relaxed">{narrative.headline}</p>
            </div>

            <GoalSection goal={facts.goal} unit={unit} zh={zh} weightUnit={weightUnit} summary={summary} muscle={muscle} />

            {/* Four numbers, each against last period */}
            <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-ink/10 max-md:rounded-none max-md:border-x-0 max-md:[&>div:nth-child(2n+1)]:pl-0 dark:border-white/10 [&>div:nth-child(2n)]:border-l [&>div:nth-child(n+3)]:border-t [&>div]:border-ink/10 dark:[&>div]:border-white/10">
                <Kpi label={t('kpi.sessions')} value={facts.sessions.planned != null ? <>{facts.sessions.done}<small className="text-base font-medium text-ink/40 dark:text-white/40"> / {facts.sessions.planned}</small></> : facts.sessions.done}
                    note={facts.sessions.planned != null ? (missed > 0 ? t('kpi.missed', { n: missed }) : t('kpi.allDone')) : null} />
                <Kpi label={t('kpi.records')} value={facts.records.length}
                    note={facts.records.length ? facts.records.slice(0, 2).map(liftName).join(zh ? '、' : ', ') : t('kpi.noRecords', { unit })} good={facts.records.length > 0} />
                <Kpi label={t('kpi.mainLifts')} value={<>{facts.liftsSummary.up}<small className="text-base font-medium text-ink/40 dark:text-white/40"> {t('kpi.up')}</small></>}
                    note={t('kpi.rest', { flat: facts.liftsSummary.flat, down: facts.liftsSummary.down })} />
                <Kpi label={t('kpi.weight')} value={facts.bodyWeight.latestKg != null ? <>{bodyWeight(facts.bodyWeight.latestKg)}<small className="text-base font-medium text-ink/40 dark:text-white/40"> {weightUnit}</small></> : '—'}
                    note={facts.bodyWeight.changeKg != null ? t('kpi.weightChange', { unit, back: facts.bodyWeight.changeWindows ?? 1, change: `${facts.bodyWeight.changeKg > 0 ? '+' : ''}${bodyWeight(facts.bodyWeight.changeKg)}` }) : facts.bodyWeight.latestKg == null ? t('kpi.noWeight') : null} />
            </dl>

            <WeekDots days={facts.sessions.days} zh={zh} />

            {/* Last report's advice, followed up */}
            {followUps.length > 0 && (
                <section className="space-y-2">
                    <SectionTitle title={t('followUpTitle')} count={t('followUpCount', { done: followUps.filter((f) => f.status === 'done').length, total: followUps.length })} />
                    <ul className="space-y-1.5">
                        {followUps.map((f) => (
                            <li key={f.id} className="grid grid-cols-[22px_1fr] gap-2 text-sm text-ink/70 max-md:text-[15px] dark:text-white/70">
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
                    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 max-md:bg-transparent max-md:p-0 max-md:text-[15px] dark:bg-emerald-400/10 dark:text-emerald-300 max-md:dark:bg-transparent">{t('noAdvice', { unit })}</p>
                ) : (
                    <ol className={summary
                        ? 'divide-y divide-ink/10 dark:divide-white/10'
                        : 'space-y-2.5 max-md:space-y-0 max-md:divide-y max-md:divide-ink/10 max-md:dark:divide-white/10'}>
                        {shownItems.map((item, i) => (
                            <li key={item.rule ?? item.findingId} className={summary
                                ? 'py-2.5 first:pt-0 last:pb-0'
                                : 'space-y-2 rounded-xl border border-ink/10 p-3.5 max-md:rounded-none max-md:border-0 max-md:px-0 max-md:py-3 dark:border-white/10'}>
                                <div className="grid grid-cols-[24px_1fr] items-start gap-2.5">
                                    <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-plate text-xs font-bold text-chalk dark:bg-chalk dark:text-plate">{i + 1}</span>
                                    <p className="font-semibold leading-relaxed">{item.action}</p>
                                </div>
                                {/* Written by code, one per finding: a low muscle and its options */}
                                {!!item.lines?.length && (
                                    <ul className="mt-1.5 space-y-1 pl-[34px] text-sm leading-relaxed">
                                        {item.lines.map((line, i) => (
                                            // A plan's options all start with "or": the label is no key
                                            <li key={i}>
                                                {/* In the report's language, which may not be the app's now */}
                                                <span className="font-semibold">{line.label}</span>{/[一-鿿]/.test(line.label) ? '：' : ': '}{line.text}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {/* The reasons and research are in the full report */}
                                {!summary && (
                                    <dl className="space-y-1 pl-[34px] text-[13px] text-ink/70 dark:text-white/70">
                                        {/* The other lifts' reasons are one line, as their advice is one item */}
                                        {item.findings[0].rule === 'next_session'
                                            ? <Reason tag={t('why')} tone="data">{item.findings.map((f, j) => <span key={f.id}>{j > 0 && ' · '}{why(f)}</span>)}</Reason>
                                            : item.findings.map((f) => <Reason key={f.id} tag={t('why')} tone="data">{why(f)}</Reason>)}
                                        {CODE_RULES.has(item.findings[0].rule)
                                            ? planResearch(item.findings[0]).map(([text, sources, part]) => (
                                                // The same research again further down is one short line, not the paragraph
                                                <Reason key={text} tag={t('research')} tone="study">{researchSeen(i, part) ? t('planResearchAgain') : text}<Sources sources={sources} /></Reason>
                                            ))
                                            : (
                                                <Reason tag={t('research')} tone="study">
                                                    {t(`researchText.${item.findings[0].rule}`)}<Sources sources={EVIDENCE[item.findings[0].rule].sources} />
                                                </Reason>
                                            )}
                                    </dl>
                                )}
                            </li>
                        ))}
                    </ol>
                )}
                {summary && items.length > shownItems.length && (
                    <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('nextMore', { n: items.length - shownItems.length })}</p>
                )}
            </section>

            {/* No goal: one small line last, so a user who only logs isn't asked for one first thing every week */}
            {facts.goal.read === null && (
                <p className="text-[13px] text-ink/50 dark:text-white/50">
                    {t('goal.none')}{' '}
                    <Link href="/settings" className="font-semibold text-ink underline underline-offset-2 dark:text-white">{t('goal.setGoal')}</Link>
                </p>
            )}

            {/* A right arrow: it goes somewhere else, it doesn't open here */}
            {summary && fullHref && (
                <Link href={fullHref}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-plate py-3 text-sm font-bold hover:bg-ink/5 max-md:text-[15px] dark:border-chalk dark:hover:bg-white/5">
                    {t('openFull')} <span aria-hidden="true">→</span>
                </Link>
            )}

            {!summary && (
                <div className="space-y-2">
                    <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('accordionHint')}</p>
                    <div className="divide-y divide-ink/10 rounded-xl border border-ink/10 max-md:rounded-none max-md:border-x-0 dark:divide-white/10 dark:border-white/10">
                        {facts.goal.read?.model && (
                            <Row {...row('goal')} title={t('goal.detailTitle')} take={null}>
                                <GoalDetail goal={facts.goal} unit={unit} zh={zh} weightUnit={weightUnit} muscle={muscle} />
                            </Row>
                        )}
                        <Row {...row('muscles')} title={t('section.muscles')} take={lowGroups.length ? t('section.musclesLow', { groups: lowGroups.map(muscle).join(zh ? '、' : ', ') }) : t('section.musclesOk')} tone={lowGroups.length ? 'warn' : 'good'}>
                            <BodyMap muscles={facts.muscles} frontLabel={t('front')} backLabel={t('back')} />
                            <Legend items={[['bg-emerald-500/80', t('legend.ok')], ['bg-amber-500/85', t('legend.low')], ['bg-sky-500/80', t('legend.high')], ['bg-ink/25 dark:bg-white/25', t('legend.none')]]} />
                            <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">
                                {t('musclesNote', { sets: facts.totalSets.now, unit })} {facts.totalSets.previous != null && t('musclesNotePrev', { prev: facts.totalSets.previous, unit })}
                            </p>
                            <MuscleBars muscles={facts.muscles} label={muscle} />
                        </Row>
                        <Row {...row('lifts')} title={t('section.lifts')} take={facts.records.length ? t('section.recordsCount', { n: facts.records.length }) : null} tone="good">
                            {facts.records.length > 0 && (
                                <ul className="space-y-1.5">
                                    {facts.records.map((r) => (
                                        <li key={r.exerciseId} className="flex items-center gap-2.5 rounded-lg bg-[#C8955A]/15 px-3 py-2 text-sm max-md:rounded-none max-md:bg-transparent max-md:px-0 max-md:text-[15px]">
                                            <span className="text-xs font-bold tracking-wider text-[#A8742F] dark:text-[#D9AA6E]">PR</span>
                                            <b className="flex-1 font-semibold">{liftName(r)} {bestText(r.best, r)}</b>
                                            <span className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{shortDate(r.date)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <LiftTable lifts={facts.lifts} name={liftName} set={(l) => bestText(l.best, l)}
                                prev={(l) => bestText(l.previousBest, l)}
                                trendLabel={(l) => t(`trend.${l.trend}`)}
                                trendNote={(l) => l.trend === 'flat' && l.flatWindows ? t('flatFor', { n: l.flatWindows, unit }) : l.change != null && l.trend !== 'new' ? (l.bodyweight ? `${l.change > 0 ? '+' : ''}${l.change}` : `${l.change > 0 ? '+' : ''}${l.change}%`) : null} />
                            <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('liftsNote', { unit })}</p>
                            {liftWatches.map((w) => <WatchNote key={w.subject} label={`${t('section.watching')}${zh ? '：' : ': '}`}>{t('liftWatch', { lift: liftName(w.data), n: Number(w.data.flatWindows), unit })}</WatchNote>)}
                        </Row>
                        {cardio && (
                            <Row {...row('cardio')} title={t('section.cardio')} take={cardio.minutes ? t('section.cardioTake', { minutes: cardio.minutes }) : null}>
                                <CardioSection cardio={cardio} unit={unit} zh={zh} name={liftName} distanceUnit={distanceUnit} research={t('research')} />
                            </Row>
                        )}
                        <Row {...row('weight')} title={t('section.weight')} take={weightWatch ? t('section.watching') : facts.bodyWeight.latestKg == null ? t('section.noWeight') : null}>
                            {facts.bodyWeight.latestKg != null && (
                                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                                    <Sparkline values={facts.bodyWeight.series} width={220} height={56} className="w-full text-[#C8955A]" label={t('section.weight')} />
                                    <div className="text-right">
                                        <p className="text-2xl font-semibold tabular-nums">{bodyWeight(facts.bodyWeight.latestKg)}<small className="text-sm font-medium text-ink/40 dark:text-white/40"> {weightUnit}</small></p>
                                        <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('weighIns', { n: facts.bodyWeight.weighIns, unit })}</p>
                                    </div>
                                </div>
                            )}
                            {weightWatch && <WatchNote label={`${t('section.watching')}${zh ? '：' : ': '}`}>{t('weightWatch', { direction: String(weightWatch.data.direction), n: Number(weightWatch.data.periods), needed: Number(weightWatch.data.needed), unit })}</WatchNote>}
                        </Row>
                        {facts.context && (
                            <Row {...row('context')} title={t('context.title')} take={null}>
                                <ContextDetail facts={facts} unit={unit} />
                            </Row>
                        )}
                        {basis.length > 0 && (
                            <Row {...row('basis')} title={t('section.basis')} take={String(basis.length)}>
                                {basis.map((f) => (
                                    <div key={f.id} className="space-y-1.5 rounded-lg border border-ink/10 p-3 text-[13px] max-md:rounded-none max-md:border-0 max-md:border-t max-md:px-0 max-md:first:border-t-0 max-md:first:pt-0 dark:border-white/10">
                                        <h4 className="text-sm font-semibold">{advised(f)}</h4>
                                        <dl className="grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1">
                                            <dt className="text-ink/50 dark:text-white/50">{t('basisLabels.rule')}</dt><dd className="text-ink/70 dark:text-white/70">{t(`ruleText.${f.rule}`, { unit })}{EVIDENCE[f.rule].ownThreshold && <span className="text-xs text-ink/40 max-md:text-[13px] dark:text-white/40"> · {t('ownSetting')}</span>}</dd>
                                            <dt className="text-ink/50 dark:text-white/50">{t('basisLabels.data')}</dt><dd className="text-ink/70 dark:text-white/70">{why(f)}</dd>
                                            <dt className="text-ink/50 dark:text-white/50">{t('basisLabels.research')}</dt><dd className="text-ink/70 dark:text-white/70">{t(`researchText.${f.rule}`)}<Sources sources={EVIDENCE[f.rule].sources} /></dd>
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
                                        <dd className="text-ink/70 dark:text-white/70">{t(`glossary.${k}.text`, { unit })}{GLOSSARY_SOURCES[k] && <Sources sources={GLOSSARY_SOURCES[k]} />}</dd>
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

type GoalSectionProps = {
    goal: ReportFacts['goal']
    unit: 'week' | 'cycle'
    zh: boolean
    weightUnit: WeightUnit
    muscle: (g: string) => string
}

/** Shared by the goal rows and their detail: names, weights in the goal's own unit */
function useGoalText({ goal, zh, weightUnit, muscle }: GoalSectionProps) {
    const t = useTranslations('reportV3.goal')
    const read = goal.read ?? null
    // One unit for the goal: the one it wrote its numbers in, else the user's
    const u: WeightUnit = read?.targets.find((x) => x.unit)?.unit ?? weightUnit
    const num = (kg: number) => String(toDisplayWeight(kg, u))
    const name = (x: { name?: string; nameZh?: string | null }) => String((zh && x.nameZh) || x.name || '')
    const sep = zh ? '、' : ', '
    const focusLabel = (units: string[] | undefined) => (units ?? []).map(muscle).join(sep)
    return { t, read, u, num, name, sep, focusLabel }
}

/**
 * The goal, first in the report: one row per target, its value against the target and, where
 * a number has one, a bar (report.facts.goal). Two lines a row and at most three rows, as fitness
 * apps put goals at a glance (2026-10-20); how each is measured, the sources and the goal as read
 * are in the full report's closed "How the goal is tracked" row (GoalDetail). Reports saved before
 * goals were read show nothing here.
 */
function GoalSection(props: GoalSectionProps & { summary: boolean }) {
    const { goal, unit, summary } = props
    const { t, read, u, num, name, focusLabel } = useGoalText(props)
    // Without a goal, the line asking for one is under the advice
    if (!read) return null
    if (!read.model) {
        return (
            <p className="text-sm text-ink/60 max-md:text-[15px] dark:text-white/60">
                <b className="font-bold text-ink dark:text-white">{t('title')}</b>{' · '}{t('notRead')}
            </p>
        )
    }

    const rows = (goal.progress ?? []).map((p) => {
        const tg = p.target
        const key = `${tg.kind}:${tg.exerciseId ?? tg.text}`
        const change = p.change != null ? t('change', { n: p.changeWindows ?? 0, unit, change: `${p.change > 0 ? '+' : ''}${num(p.change)} ${u}` }) : null
        if (tg.kind === 'lift' && tg.loadKg == null && tg.reps != null) {
            if (p.bestReps != null) return { key, label: name(tg), value: t('reps', { n: p.bestReps, target: tg.reps }), bar: Math.min(1, p.bestReps / tg.reps), delta: null }
            if (p.assisted) return { key, label: t('assistedVia', { name: name(tg) }), value: t('assist', { kg: `${num(p.assisted.assistKg)} ${u}` }), bar: p.assisted.bodyWeightShare, delta: null }
            if (p.proxy) {
                return {
                    key, label: t('via', { name: name(tg), proxy: name(p.proxy) }),
                    // The checkpoint is an estimate, shown whole
                    value: p.proxy.checkpointKg ? `${num(p.proxy.e1rmKg)} / ${Math.round(toDisplayWeight(p.proxy.checkpointKg, u))} ${u}` : `${num(p.proxy.e1rmKg)} ${u}`,
                    bar: p.proxy.checkpointKg ? Math.min(1, p.proxy.e1rmKg / p.proxy.checkpointKg) : null, delta: null,
                }
            }
            return { key, label: name(tg), value: t('noLog'), bar: null, delta: null }
        }
        if (tg.kind === 'lift') {
            const now = p.e1rmKg != null ? num(p.e1rmKg) : '—'
            return {
                key, label: name(tg),
                value: tg.loadKg != null ? `${now} / ${num(tg.loadKg)}${tg.reps && tg.reps > 1 ? ` × ${tg.reps}` : ''} ${u}` : `${now} ${u}`,
                bar: p.share ?? null, delta: p.days === 0 ? t('notTrained', { unit }) : change,
            }
        }
        if (tg.kind === 'body_weight') {
            return { key, label: t('bodyWeight'), value: `${p.latestKg != null ? num(p.latestKg) : '—'} → ${num(tg.weightKg ?? 0)} ${u}`, bar: null, delta: p.ratePerWeek != null ? t('perWeek', { rate: `${p.ratePerWeek > 0 ? '+' : ''}${p.ratePerWeek}` }) : null }
        }
        if (tg.kind === 'body_fat') {
            return { key, label: t('bodyFat'), value: `${p.latestPct != null ? `${p.latestPct}%` : '—'} → ${tg.bodyFatPct}%`, bar: null, delta: p.change != null ? t('change', { n: p.changeWindows ?? 0, unit, change: `${p.change > 0 ? '+' : ''}${p.change}%` }) : null }
        }
        const one = p.muscles?.length === 1
        return { key, label: one ? focusLabel(tg.units) : t('focusHead'), value: one ? t('focusSets', { n: p.muscles![0].perWeek }) : (p.muscles ?? []).map((m) => `${props.muscle(m.group)} ${m.perWeek}`).join(' · '), bar: null, delta: null }
    })
    const shown = summary ? rows.slice(0, 3) : rows
    const hasEstimate = (goal.progress ?? []).some((p) => p.target.kind === 'lift')

    return (
        <section className="space-y-2">
            <SectionTitle title={t('title')} count={hasEstimate ? t('estimated') : null} />
            {shown.length === 0 && <p className="text-sm text-ink/60 max-md:text-[15px] dark:text-white/60">{read.kinds.length ? read.kinds.map((k) => t(`kinds.${k}`)).join(' · ') : t('nothingRead')}</p>}
            <ul className="space-y-2.5">
                {shown.map((r) => (
                    <li key={r.key} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm max-md:text-[15px]">
                            <span className="min-w-0 truncate font-semibold">{r.label}</span>
                            {/* Numbers in the mono face; a value in words stays in the text face */}
                            <span className={`whitespace-nowrap tabular-nums ${/[一-鿿]/.test(r.value) ? '' : 'font-mono text-[13px] max-md:text-sm'}`}>{r.value}</span>
                        </div>
                        {(r.bar != null || r.delta) && (
                            <div className="flex items-center gap-3">
                                {r.bar != null ? (
                                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10 dark:bg-white/10" role="presentation">
                                        <div className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${Math.round(Math.min(1, r.bar) * 100)}%` }} />
                                    </div>
                                ) : <div className="flex-1" />}
                                {r.delta && <span className="whitespace-nowrap text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{r.delta}</span>}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
            {rows.length > shown.length && <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('more', { n: rows.length - shown.length })}</p>}
        </section>
    )
}

/** The goal's closed row in the full report: the goal as read, how each kind of target is measured, the sources, and where to change it */
function GoalDetail(props: GoalSectionProps) {
    const { goal, unit } = props
    const { t, read, u, num, name, sep, focusLabel } = useGoalText(props)
    if (!read?.model) return null
    const progress = goal.progress ?? []
    const readText = [
        ...read.kinds.map((k) => t(`kinds.${k}`)),
        ...read.targets.map((tg) => tg.kind === 'lift'
            ? `${name(tg)}${tg.loadKg != null ? ` ${num(tg.loadKg)} ${u}${tg.reps && tg.reps > 1 ? ` × ${tg.reps}` : ''}` : tg.reps ? ` ${t('repsTarget', { n: tg.reps })}` : ''}`
            : tg.kind === 'body_weight' ? `${t('bodyWeight')} ${num(tg.weightKg ?? 0)} ${u}`
            : tg.kind === 'body_fat' ? `${t('bodyFat')} ${tg.bodyFatPct}%`
            : focusLabel(tg.units)),
    ].join(sep)
    const proxy = progress.find((p) => p.proxy?.checkpointKg)
    const items: [string, Source[] | null][] = [
        ...(progress.some((p) => p.target.kind === 'lift' && (p.e1rmKg != null || p.proxy)) ? [[t('methodE1rm'), GOAL_EVIDENCE.e1rm] as [string, Source[]]] : []),
        ...(progress.some((p) => p.series) ? [[t('methodTrend', { unit }), null] as [string, null]] : []),
        ...(proxy ? [[t('methodPullUp', { name: name(proxy.target), proxy: name(proxy.proxy!), kg: `${num(proxy.proxy!.checkpointKg!)} ${u}` }), GOAL_EVIDENCE.pullUp] as [string, Source[]]] : []),
        ...(progress.some((p) => p.assisted) ? [[t('methodAssisted'), null] as [string, null]] : []),
        ...(progress.some((p) => p.target.kind === 'body_weight') ? [[t('methodWeight', { unit }), GOAL_EVIDENCE.bodyWeight] as [string, Source[]]] : []),
        ...(progress.some((p) => p.target.kind === 'focus') ? [[t('methodFocus'), null] as [string, null]] : []),
    ]
    return (
        <div className="space-y-2 text-[13px] text-ink/70 dark:text-white/70">
            <p>
                {t('read', { targets: readText || t('nothingRead') })}{read.unread && <> {t('unread', { text: read.unread })}</>}{' '}
                <Link href="/settings" className="font-semibold text-ink underline underline-offset-2 dark:text-white">{t('edit')}</Link>
            </p>
            <ul className="list-disc space-y-1 pl-4">
                {items.map(([text, sources]) => <li key={text}>{text}{sources && <Sources sources={sources} />}</li>)}
            </ul>
        </div>
    )
}

/** Ronnie's notes in the order they matter to training: active injuries first, healed ones last */
function noteOrder(n: ContextNote) {
    if (n.kind === 'injury') return n.state === 'active' ? 0 : 6
    if (n.kind === 'exercise') return n.state === 'dislike' ? 3 : 4
    return { equipment: 1, schedule: 2, other: 5 }[n.kind]
}

/**
 * The full report's closed row of what it went on besides the log's numbers: the goal, Ronnie's
 * notes and what the user said this period (report.facts.context), so a wrong read is seen and
 * told to Ronnie. Shown only in reports that read them.
 */
function ContextDetail({ facts, unit }: { facts: ReportFacts; unit: 'week' | 'cycle' }) {
    const t = useTranslations('reportV3.context')
    // All labels here are the app's, so the joints and quotes follow its language, not the report's
    const zh = useLocale() === 'zh-TW'
    if (!facts.context) return null
    const { memory, week } = facts.context
    const notes = [...memory].sort((a, b) => noteOrder(a) - noteOrder(b))
    const joint = (j: string) => JOINT_LABELS[j as Joint]?.[zh ? 'zh' : 'en'] ?? j
    const said = (s: WeekSignal) => (s.kind === 'pain' && s.joint ? t('painAt', { joint: joint(s.joint) }) : t(`kinds.${s.kind}`))
    const quote = (text: string) => (zh ? `「${text}」` : `"${text}"`)
    const dim = 'text-ink/45 dark:text-white/45'
    const head = 'font-semibold text-ink dark:text-white'
    return (
        <div className="space-y-3 text-[13px] text-ink/70 dark:text-white/70">
            <dl className="grid grid-cols-[88px_1fr] gap-x-2.5 gap-y-2.5">
                <dt className={head}>{t('goal')}</dt>
                <dd>{facts.goal.text ?? t('noGoal')}</dd>
                <dt className={head}>{t('memory')}</dt>
                <dd>
                    {notes.length ? (
                        <ul className="space-y-0.5">
                            {notes.map((n) => (
                                <li key={`${n.kind}:${n.subject ?? ''}`}>
                                    {n.text}
                                    <span className={dim}>{n.kind === 'injury' && n.state === 'resolved' ? ` · ${t('resolved')}` : ''} · {shortDate(n.date)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : t('noMemory')}
                </dd>
                <dt className={head}>{t('week', { unit })}</dt>
                <dd>
                    {week.failed ? t('weekFailed', { unit }) : week.signals.length ? (
                        <ul className="space-y-0.5">
                            {week.signals.map((s) => (
                                <li key={`${s.date}:${s.kind}:${s.joint ?? s.exerciseId ?? ''}`}>
                                    <span className={head}>{shortDate(s.date)} {said(s)}</span>{zh ? '：' : ': '}{quote(s.text)}
                                    <span className={dim}> · {s.source === 'note' ? t('sourceNote') : t('sourceRonnie')}</span>
                                </li>
                            ))}
                        </ul>
                    ) : week.texts ? t('weekNone', { n: week.texts }) : t('weekEmpty', { unit })}
                </dd>
                <dt className={head}>{t('log')}</dt>
                <dd>{t('logText', { n: facts.bodyWeight.series.length, unit })}</dd>
            </dl>
            <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('fix', { unit })}</p>
        </div>
    )
}

function Kpi({ label, value, note, good }: { label: string; value: React.ReactNode; note: string | null; good?: boolean }) {
    return (
        <div className="min-w-0 px-3.5 py-2.5">
            <dt className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{label}</dt>
            <dd className="text-[28px] font-semibold leading-tight tabular-nums">{value}</dd>
            {note && <dd className={`truncate text-xs max-md:text-[13px] ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink/60 dark:text-white/60'}`}>{note}</dd>}
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
                    <div key={d.date} title={d.routine ?? undefined} className="flex flex-col items-center gap-1 text-[11px] text-ink/50 max-md:text-xs dark:text-white/50">
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
            {title} {count && <span className="text-xs font-medium text-ink/50 max-md:text-[13px] dark:text-white/50">{count}</span>}
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
            <dt className={`whitespace-nowrap rounded-md px-1.5 text-[11px] font-bold max-md:text-xs ${style}`}>{tag}</dt>
            <dd>{children}</dd>
        </div>
    )
}

/** Papers, each linking to its DOI. They come from code (lib/report/evidence), never from the model. */
function Sources({ sources }: { sources: Source[] }) {
    if (!sources.length) return null
    return (
        <span className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">
            {' · '}
            {sources.map((s, i) => (
                <span key={s.doi}>
                    {i > 0 && '; '}
                    <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer" title={`${s.title}. ${s.journal}`}
                        className="underline decoration-dotted underline-offset-2 hover:text-ink dark:hover:text-white">{s.author}{s.organization || s.soleAuthor ? '' : ' et al.'}, {s.year}</a>
                </span>
            ))}
        </span>
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
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm font-bold max-md:min-h-[52px] max-md:px-0 max-md:text-[15px]">
                <span className="flex-1">{title}</span>
                {take && <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold max-md:text-[13px] ${chip}`}>{take}</span>}
                <span className={`text-ink/40 transition-transform motion-reduce:transition-none dark:text-white/40 ${open ? 'rotate-180' : ''}`} aria-hidden>▾</span>
            </button>
            {open && <div className="space-y-3 px-3.5 pb-3.5 max-md:px-0 max-md:pb-4">{children}</div>}
        </div>
    )
}

function Legend({ items }: { items: [string, string][] }) {
    return (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-ink/50 max-md:text-xs dark:text-white/50">
            {items.map(([color, label]) => <span key={label} className="flex items-center gap-1"><i className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />{label}</span>)}
        </div>
    )
}

const AXIS_MAX = 24
// Top to bottom of the body; shoulders and legs are categories in reports saved before the split
const MUSCLE_ORDER = ['chest', 'back', 'shoulders', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'core', 'glutes', 'legs', 'quads', 'hamstrings', 'calves']

function MuscleBars({ muscles, label }: { muscles: ReportV3['facts']['muscles']; label: (g: string) => string }) {
    const pct = (v: number) => `${(Math.min(v, AXIS_MAX) / AXIS_MAX) * 100}%`
    return (
        <div className="space-y-2">
            {[...muscles].sort((a, b) => (MUSCLE_ORDER.indexOf(a.group) + 1 || 99) - (MUSCLE_ORDER.indexOf(b.group) + 1 || 99)).map((m) => (
                <div key={m.group} className="grid grid-cols-[76px_1fr_44px] items-center gap-2 text-[13px]" role="img" aria-label={`${label(m.group)} ${m.perWeek}`}>
                    <span className="text-ink/70 dark:text-white/70">{label(m.group)}</span>
                    <div className="relative h-3.5 overflow-hidden rounded bg-ink/10 dark:bg-white/10">
                        {m.status !== 'no_target' && <div className="absolute inset-y-0 border-x border-dashed border-[#C8955A] bg-[#C8955A]/20" style={{ left: pct(10), width: pct(10) }} />}
                        <div className={`absolute inset-y-[3px] left-0 rounded-sm ${m.status === 'low' ? 'bg-amber-600 dark:bg-amber-400' : 'bg-ink dark:bg-white'}`} style={{ width: pct(m.perWeek) }} />
                    </div>
                    <span className={`text-right font-semibold tabular-nums ${m.status === 'low' ? 'text-amber-700 dark:text-amber-400' : ''}`}>{m.perWeek}</span>
                </div>
            ))}
            <div className="grid grid-cols-[76px_1fr_44px] gap-2 text-[10px] text-ink/40 max-md:text-xs dark:text-white/40">
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
        <div className="divide-y divide-ink/10 rounded-lg border border-ink/10 max-md:rounded-none max-md:border-x-0 dark:divide-white/10 dark:border-white/10">
            {lifts.map((l) => (
                <div key={l.exerciseId} className="grid grid-cols-[1fr_auto_76px] items-center gap-2.5 px-3 py-2 max-md:px-0 max-md:py-2.5">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold max-md:text-[15px]">{name(l)}</p>
                        <p className="text-[13px] tabular-nums text-ink/60 dark:text-white/60">{prev(l)} → {set(l)}</p>
                    </div>
                    <p className={`text-right text-xs font-bold max-md:text-[13px] ${color(l)}`}>
                        {trendLabel(l)}
                        {trendNote(l) && <small className="block text-[11px] font-medium text-ink/50 max-md:text-xs dark:text-white/50">{trendNote(l)}</small>}
                    </p>
                    <Sparkline values={l.series} className={color(l)} label={name(l)} />
                </div>
            ))}
        </div>
    )
}

/**
 * Cardio as a fact: minutes and distance, the minutes by heart rate and the heart rate at a setting
 * done again, what research says about each, and WHO's weekly amount. No advice.
 */
function CardioSection({ cardio, unit, zh, name, distanceUnit, research }: {
    cardio: CardioFacts
    unit: 'week' | 'cycle'
    zh: boolean
    name: (x: { name: string; nameZh: string | null }) => string
    distanceUnit: DistanceUnit
    research: string
}) {
    const t = useTranslations('reportV3.cardio')
    const summary = [
        cardio.minutes ? t('total', { minutes: cardio.minutes, days: cardio.days, unit }) : t('none', { unit }),
        cardio.minutes && unit === 'cycle' ? t('perWeek', { n: cardio.perWeek }) : null,
        cardio.previousPerWeek != null ? t('previous', { n: cardio.previousPerWeek, unit }) : null,
    ].filter(Boolean).join(zh ? '' : ' ')
    // By heart rate, in reports saved since it was logged: the rated minutes, WHO's count of them, the rest
    const i = cardio.intensity
    const rated = !!i && i.light + i.moderate + i.vigorous > 0
    const intensity = rated ? [
        t('intensity', { parts: (['moderate', 'vigorous', 'light'] as const).filter((k) => i[k] > 0).map((k) => t(`intensityPart.${k}`, { n: i[k] })).join(zh ? '、' : ', ') }),
        i.equivalentPerWeek != null ? t('equivalent', { n: i.equivalentPerWeek }) : null,
        i.unrated > 0 ? t('unrated', { n: i.unrated }) : null,
        i.maxHr != null ? t('maxHr', { n: i.maxHr }) : null,
    ].filter(Boolean).join(zh ? '' : ' ') : null
    const trends = cardio.trends ?? []
    const speedUnit = distanceUnit === 'mi' ? 'mph' : 'km/h'
    const settingOf = (x: CardioTrendFacts) => x.level != null
        ? t('levelSetting', { level: x.level })
        : t('treadmillSetting', { speed: toDisplaySpeed(x.speedKmh ?? 0, distanceUnit), speedUnit, incline: x.inclinePct ?? 0 })
    return (
        <>
            <p className="text-sm max-md:text-[15px]">{summary}</p>
            {cardio.exercises.length > 0 && (
                <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10 max-md:rounded-none max-md:border-x-0 dark:divide-white/10 dark:border-white/10">
                    {cardio.exercises.map((e) => (
                        <li key={e.exerciseId} className="flex items-baseline justify-between gap-2.5 px-3 py-2 text-sm max-md:px-0 max-md:py-2.5 max-md:text-[15px]">
                            <span className="min-w-0 truncate font-semibold">{name(e)}</span>
                            <span className="whitespace-nowrap tabular-nums text-ink/70 dark:text-white/70">
                                {t('minutes', { n: e.minutes })}
                                {e.km != null && ` · ${toDisplayDistance(e.km, distanceUnit)} ${distanceUnit}`}
                                {e.metres != null && ` · ${t('metres', { n: e.metres })}`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {intensity && <p className="text-sm max-md:text-[15px]">{intensity}</p>}
            {cardio.intensity?.needsAge && (
                <p className="text-sm max-md:text-[15px]">
                    {t.rich('needsAge', { link: (chunks) => <Link href="/settings" className="font-semibold underline underline-offset-2">{chunks}</Link> })}
                </p>
            )}
            {trends.length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-ink/60 max-md:text-[13px] dark:text-white/60">{t('trendTitle')}</p>
                    <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10 max-md:rounded-none max-md:border-x-0 dark:divide-white/10 dark:border-white/10">
                        {trends.map((x) => (
                            <li key={`${x.exerciseId}-${x.speedKmh}-${x.inclinePct}-${x.level}`} className="flex flex-wrap items-baseline justify-between gap-x-2.5 px-3 py-2 text-sm max-md:px-0 max-md:py-2.5 max-md:text-[15px]">
                                <span className="min-w-0 font-semibold">{name(x)} <span className="font-normal text-ink/60 dark:text-white/60">{settingOf(x)}</span></span>
                                <span className="whitespace-nowrap tabular-nums text-ink/70 dark:text-white/70">
                                    {t('trend', { first: x.first.avgHr, firstDate: shortDate(x.first.date), last: x.last.avgHr, lastDate: shortDate(x.last.date) })}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <p className="text-xs text-ink/50 max-md:text-[13px] dark:text-white/50">{t('note')}</p>
            <dl className="space-y-1 text-[13px] text-ink/70 dark:text-white/70">
                <Reason tag={research} tone="study">{t('researchText')}<Sources sources={CARDIO_EVIDENCE.research} /></Reason>
                {rated && <Reason tag={research} tone="study">{t('intensityText')}<Sources sources={CARDIO_EVIDENCE.intensity} /></Reason>}
                {trends.length > 0 && <Reason tag={research} tone="study">{t('trendText')}<Sources sources={CARDIO_EVIDENCE.trend} /></Reason>}
            </dl>
            <p className="text-[13px] text-ink/70 dark:text-white/70">{t('who')}<Sources sources={CARDIO_EVIDENCE.who} /></p>
        </>
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

