// Programmatic checks for the v3 report text. Pure functions of (case, output), so
// check-grader.mjs can exercise them offline. `output` is { narrative, findings, status, brief,
// names }: names maps each finding id to the muscle or lift its rule's action must mention.

// Characters that only appear in Simplified Chinese, for the zh-TW check
const SIMPLIFIED_ONLY = /[这们训练进动议还时对说体发让点从过关应经]/g
// Half-width punctuation right after a Chinese character
const HALF_WIDTH_AFTER_CJK = /[一-鿿][,?!:;]/

export function narrativeText(n) {
    return [n?.headline, ...(n?.items ?? []).map((i) => i.action)].filter(Boolean).join('\n')
}

export function languageCorrect(text, language) {
    const cjk = (text.match(/[一-鿿]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    if (cjk + latin === 0) return false // empty text is in no language
    const cjkShare = cjk / (cjk + latin)
    if (language === 'zh-TW') return cjkShare > 0.5 && (text.match(SIMPLIFIED_ONLY) ?? []).length <= 2 && !HALF_WIDTH_AFTER_CJK.test(text)
    return cjkShare < 0.05
}

const MARKDOWN = /\*\*|__|`|^\s*#|^\s*[-*]\s|^\s*\d+\.\s/m
// A weight in the other unit than the user's
const WRONG_UNIT = { kg: /\d\s*(lbs?|磅)/i, lb: /\d\s*(kg|公斤)/i }

export function programmaticGrade(c, out) {
    const n = out?.narrative ?? {}
    const items = n.items ?? []
    const findings = out?.findings ?? []
    const fired = [...new Set(findings.map((f) => f.rule))]
    const chosen = items.map((i) => i.rule)
    const unknown = chosen.filter((r) => !fired.includes(r))
    const missing = fired.filter((r) => !chosen.includes(r))
    const deloadFired = fired.includes('deload')
    // Every finding's muscle or lift named in its rule's action
    const unnamed = findings.filter((f) => {
        const name = out?.names?.[f.id]
        const action = items.find((i) => i.rule === f.rule)?.action ?? ''
        return name && !action.toLowerCase().includes(name.toLowerCase())
    }).map((f) => out.names[f.id])
    const headline = String(n.headline ?? '')
    const headlineLength = c.language === 'zh-TW' ? [...headline.replace(/\s/g, '')].length : headline.split(/\s+/).filter(Boolean).length

    const grade = {
        advice_valid: !unknown.length && !missing.length && new Set(chosen).size === chosen.length ? 1 : 0,
        deload_first: deloadFired ? (chosen[0] === 'deload' ? 1 : 0) : null,
        covers_all: findings.length ? (unnamed.length ? 0 : 1) : null,
        headline_short: headline && headlineLength <= (c.language === 'zh-TW' ? 45 : 30) ? 1 : 0,
        plain_text: MARKDOWN.test(narrativeText(n)) ? 0 : 1,
        language_correct: languageCorrect(narrativeText(n), c.language) ? 1 : 0,
        unit_correct: WRONG_UNIT[c.weightUnit ?? 'kg'].test(narrativeText(n)) ? 0 : 1,
    }
    const explanation = {
        advice_valid: unknown.length ? `建議了沒有觸發的規則：${unknown.join('、')}`
            : missing.length ? `觸發的規則沒有建議：${missing.join('、')}`
            : new Set(chosen).size !== chosen.length ? '同一條規則寫了兩次'
            : `觸發的 ${fired.length} 種規則各有一條建議`,
        deload_first: deloadFired ? (chosen[0] === 'deload' ? '減量排第一' : '減量沒有排第一') : undefined,
        covers_all: findings.length ? (unnamed.length ? `建議沒有提到：${unnamed.join('、')}` : '每個肌群和動作都有提到') : undefined,
        headline_short: `標題長度 ${headlineLength}${c.language === 'zh-TW' ? ' 字（上限 45）' : ' 個字（上限 30）'}`,
        plain_text: grade.plain_text ? '沒有 Markdown' : '有 Markdown 符號',
        language_correct: grade.language_correct ? `語言符合 ${c.language}` : `語言不符合 ${c.language}，或中文用了半形標點`,
        unit_correct: grade.unit_correct ? `重量單位都是 ${c.weightUnit ?? 'kg'}` : `出現了不是 ${c.weightUnit ?? 'kg'} 的重量單位`,
    }
    return { grade, explanation }
}

/** Every applicable check passed. */
export function overallPass(grade) {
    return Object.values(grade).filter((v) => v != null).every((v) => v === 1) ? 1 : 0
}
