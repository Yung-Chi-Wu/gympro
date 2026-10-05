// Programmatic checks for the weekly-report eval. Pure functions of
// (case, report) so they can be exercised offline by check-grader.mjs.

// muscleImbalances[].muscleGroup is free text ("背部", "胸肌 vs. 背部", "Legs"),
// so map it onto the summary's muscle group keys. A "X vs Y" entry counts for both.
export const GROUP_PATTERNS = {
    chest: /\bchest\b|\bpecs?\b|胸/i,
    back: /\bback\b|\blats?\b|背/i,
    legs: /\blegs?\b|\bquads?\b|\bhamstrings?\b|lower body|腿|下肢|下半身/i,
    shoulders: /\bshoulders?\b|\bdelts?\b|肩/i,
    biceps: /\bbiceps?\b|二頭/i,
    triceps: /\btriceps?\b|三頭/i,
    glutes: /\bglutes?\b|臀/i,
    core: /\bcore\b|\babs\b|核心|腹/i,
}
export const SEVERITY_RANK = { mild: 1, moderate: 2, severe: 3 }

const GROUP_NAMES_ZH = { chest: '胸', back: '背', legs: '腿', shoulders: '肩', biceps: '二頭', triceps: '三頭', glutes: '臀', core: '核心' }

/** Map of muscle group -> highest severity the report flagged it at. */
export function flaggedGroups(imbalances) {
    const flagged = new Map()
    for (const imb of imbalances ?? []) {
        for (const [group, re] of Object.entries(GROUP_PATTERNS)) {
            if (!re.test(String(imb.muscleGroup ?? ''))) continue
            const rank = SEVERITY_RANK[imb.severity] ?? 1
            flagged.set(group, Math.max(flagged.get(group) ?? 0, rank))
        }
    }
    return flagged
}

export function reportText(out) {
    return [
        out?.headline, out?.summary, out?.progressiveOverload?.notes, out?.deloadReason,
        ...(out?.muscleImbalances ?? []).map((m) => m.observation),
        ...(out?.actionItems ?? []),
    ].filter(Boolean).join('\n')
}

// Characters that only appear in Simplified Chinese, for the zh-TW check
const SIMPLIFIED_ONLY = /[这们训练进动议还时对说体发让点从过关应经]/g

export function languageCorrect(text, language) {
    const cjk = (text.match(/[一-鿿]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    if (cjk + latin === 0) return false // an empty report is in no language
    const cjkShare = cjk / (cjk + latin)
    if (language === 'zh-TW') return cjkShare > 0.5 && (text.match(SIMPLIFIED_ONLY) ?? []).length <= 2
    return cjkShare < 0.05
}

/**
 * Programmatic grade for one report. Metrics that don't apply to the case are
 * null, and the report builder leaves nulls out of the means.
 */
export function programmaticGrade(c, out) {
    const exp = c.expected
    const flagged = flaggedGroups(out?.muscleImbalances)
    const grade = {
        status_correct: out?.progressiveOverload?.status === exp.status ? 1 : 0,
        imbalance_recall: exp.imbalanced.length
            ? exp.imbalanced.filter((g) => flagged.has(g)).length / exp.imbalanced.length
            : null,
        no_false_alarm: exp.balanced.length
            ? (exp.balanced.some((g) => (flagged.get(g) ?? 0) >= SEVERITY_RANK.moderate) ? 0 : 1)
            : null,
        deload_correct: exp.deload == null ? null : (out?.deloadRecommended === exp.deload ? 1 : 0),
        language_correct: languageCorrect(reportText(out), exp.language) ? 1 : 0,
    }
    const names = (groups) => groups.map((g) => GROUP_NAMES_ZH[g] ?? g).join('、') || '無'
    const falseAlarms = exp.balanced.filter((g) => (flagged.get(g) ?? 0) >= SEVERITY_RANK.moderate)
    const explanation = {
        status_correct: `預期 ${exp.status}，實際 ${out?.progressiveOverload?.status ?? '（沒有回答）'}`,
        imbalance_recall: `應該標出：${names(exp.imbalanced)}；實際標出：${names([...flagged.keys()])}`,
        no_false_alarm: falseAlarms.length ? `把不該報的${names(falseAlarms)}標成中度以上失衡` : `不該報的肌群（${names(exp.balanced)}）都沒有被標成中度以上`,
        deload_correct: exp.deload == null ? undefined : `預期 ${exp.deload ? '建議減量' : '不減量'}，實際 ${out?.deloadRecommended === true ? '建議減量' : out?.deloadRecommended === false ? '不減量' : '（沒有回答）'}`,
        language_correct: grade.language_correct ? `輸出語言符合 ${exp.language}` : `輸出語言不是 ${exp.language}`,
    }
    return { grade, explanation }
}

/** Headline: every applicable check passed (imbalance recall must be complete). */
export function overallPass(grade) {
    return Object.values(grade).filter((v) => v != null).every((v) => v === 1) ? 1 : 0
}
