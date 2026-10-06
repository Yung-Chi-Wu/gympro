// Programmatic checks for the Ronnie eval. Pure functions of (case, conversation,
// exercise list) so check-grader.mjs can exercise them offline. A metric that
// doesn't apply to the case is null and stays out of the means.

const FALLBACKS = ['抱歉，請再問一次。', 'Sorry, please try again.']
const SIMPLIFIED_ONLY = /[这们训练进动议还时对说体发让点从过关应经]/g
const OP_ZH = { add_today: '加入今天', remove_today: '從今天移除', delete_from_routines: '從所有課表永久刪除' }

// Ronnie's catchphrase is English by design, so it doesn't count against a Chinese reply
const CATCHPHRASE = /ain['’]?t\s+nothin['’]?\s+but\s+a\s+peanut!?/gi

export function languageCorrect(text, language) {
    text = String(text).replace(CATCHPHRASE, '')
    const cjk = (text.match(/[一-鿿]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    if (cjk + latin === 0) return false
    const share = cjk / (cjk + latin)
    // Chinese replies keep English exercise names now and then, and English ones quote the
    // user's Chinese routine names (推日), so both bars leave room for names
    if (language === 'zh-TW') return share > 0.4 && (text.match(SIMPLIFIED_ONLY) ?? []).length <= 2
    return share < 0.1
}

/**
 * Exercises named in a reply. Longest names are matched first and masked, so
 * "上斜啞鈴臥推" doesn't also count as "啞鈴臥推", or "Romanian Deadlift" as "Deadlift".
 */
export function exercisesMentioned(text, exercises) {
    let rest = String(text ?? '')
    const found = new Set()
    const names = exercises
        .flatMap((e) => [[e.name, e.id, true], [e.name_zh_tw, e.id, false]])
        .filter(([n]) => n)
        .sort((a, b) => b[0].length - a[0].length)
    for (const [name, id, latin] of names) {
        // English names match case-insensitively and in the plural ("face pulls")
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = latin ? new RegExp(escaped + 's?', 'gi') : new RegExp(escaped, 'g')
        if (re.test(rest)) {
            found.add(id)
            rest = rest.replace(re, '\u0000')
        }
    }
    return found
}

export function programmaticGrade(c, out, exercises) {
    const exp = c.expect
    const byId = new Map(exercises.map((e) => [e.id, e]))
    const idFor = (name) => exercises.find((e) => e.name === name)?.id
    const label = (id) => byId.get(id)?.name_zh_tw ?? `不存在的 ID ${String(id).slice(0, 8)}…`
    const calls = out.turns.flatMap((t) => t.toolCalls)
    const called = new Set(calls.map((x) => x.name))
    const finalReply = out.turns.at(-1)?.message ?? ''
    const actualWrites = out.turns.flatMap((t, i) => t.writes.map((w) => ({ ...w, turn: i + 1 })))
    const grade = {}
    const explanation = {}

    if (exp.tools_required || exp.tools_forbidden) {
        const missing = (exp.tools_required ?? []).filter((t) => !called.has(t))
        const forbidden = (exp.tools_forbidden ?? []).filter((t) => called.has(t))
        grade.right_tools = missing.length || forbidden.length ? 0 : 1
        explanation.right_tools = [
            missing.length ? `沒有呼叫：${missing.join('、')}` : '',
            forbidden.length ? `不該呼叫卻呼叫了：${forbidden.join('、')}` : '',
        ].filter(Boolean).join('；') || `呼叫的工具：${[...called].join('、') || '（沒有）'}`
    } else grade.right_tools = null

    if (exp.writes) {
        // Only writes that changed something count as changes; a write the app rejected
        // (unknown id, nothing to remove) is tracked by valid_ids instead
        const effective = actualWrites.filter((a) => a.effective !== false)
        const missing = []
        const unmatched = [...effective]
        let clarified = false
        let alreadyPlanned = false
        for (const w of exp.writes) {
            let allowed
            if (w.exercise === '$recommended') {
                allowed = exercisesMentioned(out.turns[w.turn - 2]?.message, exercises)
                // More than one was recommended, so "add it" is ambiguous and asking which one is right
                // too. Recommended names aren't always library names ("incline bench press"), so a
                // question that offers two or more library exercises also counts as clarifying.
                const reply = out.turns[w.turn - 1]?.message ?? ''
                const wroteThisTurn = effective.some((a) => a.turn === w.turn)
                const offered = exercisesMentioned(reply, exercises)
                if ((allowed.size >= 2 || offered.size >= 2) && !wroteThisTurn && /[?？]/.test(reply)) {
                    clarified = true
                    continue
                }
                // The recommended exercise is already in today's workout and the reply says so: nothing to add.
                // Tool results show short (8-character) ids, so match them as prefixes.
                const shownToday = (out.turns[w.turn - 1]?.toolCalls ?? [])
                    .filter((x) => x.name === 'get_today_workout')
                    .flatMap((x) => [...String(x.result).matchAll(/ID: ([0-9a-f-]{8,36})/g)].map((m) => m[1]))
                const plannedToday = (id) => shownToday.some((shown) => id.startsWith(shown))
                if (!wroteThisTurn && [...allowed].some((id) => plannedToday(id) && offered.has(id))) {
                    alreadyPlanned = true
                    continue
                }
                if (!allowed.size) missing.push(`第 ${w.turn - 1} 句回覆沒有推薦動作庫裡的任何動作`)
            } else allowed = new Set([idFor(w.exercise)])
            const i = unmatched.findIndex((a) => a.op === w.op && a.turn === w.turn && allowed.has(a.exerciseId))
            if (i >= 0) unmatched.splice(i, 1)
            else missing.push(`第 ${w.turn} 句應該${OP_ZH[w.op]}：${w.exercise === '$recommended' ? '剛才推薦的動作' : label(idFor(w.exercise))}`)
        }
        grade.change_done = exp.writes.length ? (missing.length ? 0 : 1) : null
        if (exp.writes.length) {
            explanation.change_done = missing.join('；')
                || (clarified ? '推薦了不只一個動作，反問要加哪一個（合理）'
                    : alreadyPlanned ? '推薦的動作本來就在今天的課表裡，回覆有說明（合理）'
                    : '該改的都改了')
        }
        grade.no_wrong_change = unmatched.length ? 0 : 1
        explanation.no_wrong_change = unmatched.length
            ? unmatched.map((a) => `改錯：第 ${a.turn} 句${OP_ZH[a.op]}「${label(a.exerciseId)}」`).join('；')
            : '沒有改到不該改的東西'
    } else {
        grade.change_done = null
        grade.no_wrong_change = null
    }

    if (actualWrites.length) {
        const invented = actualWrites.filter((a) => !byId.has(a.exerciseId))
        grade.valid_ids = invented.length ? 0 : 1
        explanation.valid_ids = invented.length ? `用了動作庫裡不存在的 ID（${invented.length} 次），已被擋下，沒有改到資料` : '用到的動作 ID 都存在'
    } else grade.valid_ids = null

    if (exp.mentions) {
        const missing = exp.mentions.filter((m) => !finalReply.includes(m))
        grade.mentions_expected = missing.length ? 0 : 1
        explanation.mentions_expected = missing.length ? `回覆沒有提到：${missing.join('、')}` : '該提到的都有提到'
    } else grade.mentions_expected = null

    if (exp.history_range) {
        const { cover: [from, to], earliest, latest } = exp.history_range
        const ranges = calls.filter((x) => x.input?.date_from && x.input?.date_to).map((x) => [x.input.date_from, x.input.date_to])
        const ok = ranges.some(([a, b]) => a <= from && b >= to && a >= earliest && b <= latest)
        grade.date_range = ok ? 1 : 0
        explanation.date_range = `應涵蓋 ${from}～${to}（範圍在 ${earliest}～${latest} 內）；實際查詢：${ranges.map(([a, b]) => `${a}～${b}`).join('、') || '（沒有查）'}`
    } else grade.date_range = null

    const fellBack = out.turns.filter((t) => !t.message.trim() || FALLBACKS.includes(t.message.trim()))
    grade.no_fallback = fellBack.length ? 0 : 1
    explanation.no_fallback = fellBack.length ? `有 ${fellBack.length} 句回覆是空的，或是「抱歉，請再問一次」（迴圈用完）` : '每句都有正常回覆'

    grade.language_correct = out.turns.every((t) => languageCorrect(t.message, c.language)) ? 1 : 0
    explanation.language_correct = grade.language_correct ? `回覆語言符合 ${c.language}` : `有回覆不是 ${c.language}`

    return { grade, explanation }
}

// Tracked but not part of the overall pass: an id the app rejected changed nothing,
// and what matters to the user (wrong or missed changes) is graded separately
const DIAGNOSTIC = new Set(['valid_ids'])

/** Every applicable check passed. */
export function overallPass(grade) {
    return Object.entries(grade).filter(([k, v]) => v != null && !DIAGNOSTIC.has(k)).every(([, v]) => v === 1) ? 1 : 0
}
