// Programmatic checks for the v3 report text. Pure functions of (case, output), so
// check-grader.mjs can exercise them offline. `output` is { narrative, findings, status, brief }.

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

export function programmaticGrade(c, out) {
    const n = out?.narrative ?? {}
    const items = n.items ?? []
    const fired = (out?.findings ?? []).map((f) => f.id)
    const chosen = items.map((i) => i.findingId)
    const unknown = chosen.filter((id) => !fired.includes(id))
    const deloadFired = fired.includes('deload:-')
    const headline = String(n.headline ?? '')
    const headlineLength = c.language === 'zh-TW' ? [...headline.replace(/\s/g, '')].length : headline.split(/\s+/).filter(Boolean).length

    const grade = {
        advice_valid: !unknown.length && new Set(chosen).size === chosen.length && chosen.length <= 3 && (fired.length > 0) === (chosen.length > 0) ? 1 : 0,
        deload_first: deloadFired ? (chosen[0] === 'deload:-' ? 1 : 0) : null,
        top_included: fired.length ? (chosen.includes(fired[0]) ? 1 : 0) : null,
        headline_short: headline && headlineLength <= (c.language === 'zh-TW' ? 45 : 30) ? 1 : 0,
        plain_text: MARKDOWN.test(narrativeText(n)) ? 0 : 1,
        language_correct: languageCorrect(narrativeText(n), c.language) ? 1 : 0,
    }
    const explanation = {
        advice_valid: unknown.length ? `建議了沒有觸發的規則：${unknown.join('、')}`
            : chosen.length > 3 ? `寫了 ${chosen.length} 項，超過 3 項`
            : new Set(chosen).size !== chosen.length ? '同一條規則寫了兩次'
            : fired.length && !chosen.length ? '有觸發規則卻沒有給建議'
            : !fired.length && chosen.length ? '沒有觸發規則卻給了建議'
            : `建議 ${chosen.length} 項，都來自觸發的規則（${fired.length} 條）`,
        deload_first: deloadFired ? (chosen[0] === 'deload:-' ? '減量排第一' : '減量沒有排第一') : undefined,
        top_included: fired.length ? (chosen.includes(fired[0]) ? `最優先的 ${fired[0]} 有寫到` : `漏掉最優先的 ${fired[0]}`) : undefined,
        headline_short: `標題長度 ${headlineLength}${c.language === 'zh-TW' ? ' 字（上限 45）' : ' 個字（上限 30）'}`,
        plain_text: grade.plain_text ? '沒有 Markdown' : '有 Markdown 符號',
        language_correct: grade.language_correct ? `語言符合 ${c.language}` : `語言不符合 ${c.language}，或中文用了半形標點`,
    }
    return { grade, explanation }
}

/** Every applicable check passed. */
export function overallPass(grade) {
    return Object.values(grade).filter((v) => v != null).every((v) => v === 1) ? 1 : 0
}
