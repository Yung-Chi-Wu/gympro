// Programmatic checks for the Ronnie eval. Pure functions of (case, conversation,
// exercise list) so check-grader.mjs can exercise them offline. A metric that
// doesn't apply to the case is null and stays out of the means.

import { readFileSync } from 'node:fs'

const FALLBACKS = ['抱歉，請再問一次。', 'Sorry, please try again.']
// Each knowledge note's DOI, to tell which notes a reply's sources are (lib/ronnie/knowledge-notes.json)
const NOTE_DOI = new Map(JSON.parse(readFileSync(new URL('../../lib/ronnie/knowledge-notes.json', import.meta.url), 'utf8')).map((n) => [n.id, n.source.doi.toLowerCase()]))
const SIMPLIFIED_ONLY = /[这们训练进动议还时对说体发让点从过关应经]/g
const OP_ZH = { add_today: '加入今天', remove_today: '從今天移除', delete_from_routines: '從所有課表永久刪除' }

// Ronnie's catchphrase is English by design, so it doesn't count against a Chinese reply
const CATCHPHRASE = /ain['’]?t\s+nothin['’]?\s+but\s+a\s+peanut!?/gi

// A half-width , ; : ? ! touching a Chinese character: the English system prompt (2026-10-07)
// made Chinese replies use them in 36 of 95 replies, and the share check alone missed it
const HALF_WIDTH_PUNCT = /[一-鿿][,;:?!]|[,;:?!][一-鿿]/

// Saying it has saved something, or will remember it. In a turn that changed no memory note
// that is a false claim, the kind the add-without-adding bug was (2026-10-06). The Chinese
// forms need no 我: the memory baseline had 好，記住了 and 已記下 (2026-10-13). An imperative to
// the user (記住要保持核心收緊) has no 了 and isn't one. A bare "noted" counts only as an
// acknowledgement ("Noted.", "Got it, noted!"): "you've noted that overhead pressing bothers it"
// recalls what the user said (memory v1, 2026-10-13).
const MEMORY_CLAIM = /(記住|記下|記起來|記好)了|已(經)?(幫你)?記(住|下|起來|好)|我(會|已經|已|先|都|有)?(記住|記下|記起來|記好)|我(會|一定會)記得|幫你記(住|下|起來)|I(['’]ll| will| have|['’]ve)\s+(remember|noted?|saved|make a note|keep (that|this) in mind)|(?<!\b(you|you['’]ve|you have|as)\s)\bnoted\s*([.!,:;—–-]|$)/im
const MEMORY_KIND_ZH = { injury: '舊傷', exercise: '動作喜好', equipment: '器材', schedule: '訓練時間', other: '其他' }
const JOINT_ZH = { shoulder: '肩膀', elbow: '手肘', lower_back: '下背', knee: '膝蓋', wrist: '手腕', hip: '髖', ankle: '腳踝', neck: '脖子' }
const LOAD_RANK = { none: 0, low: 1, medium: 2, high: 3 }

export function languageCorrect(text, language) {
    text = String(text).replace(CATCHPHRASE, '')
    const cjk = (text.match(/[一-鿿]/g) ?? []).length
    const latin = (text.match(/[A-Za-z]/g) ?? []).length
    if (cjk + latin === 0) return false
    const share = cjk / (cjk + latin)
    // Chinese replies keep English exercise names now and then, and English ones quote the
    // user's Chinese routine names (推日), so both bars leave room for names
    if (language === 'zh-TW') return share > 0.4 && (text.match(SIMPLIFIED_ONLY) ?? []).length <= 2 && !HALF_WIDTH_PUNCT.test(text)
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
                // Named in the previous reply, or shown as a recommendation card (short ids are prefixes)
                const carded = (out.turns[w.turn - 2]?.toolCalls ?? [])
                    .filter((x) => x.name === 'recommend_exercise')
                    .flatMap((x) => exercises.filter((e) => x.input?.exercise_id && e.id.startsWith(String(x.input.exercise_id).toLowerCase().slice(0, 8))).map((e) => e.id))
                allowed = new Set([...exercisesMentioned(out.turns[w.turn - 2]?.message, exercises), ...carded])
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

    // Memory, for the cases about it: the notes after the last conversation, what the last
    // day's recommendations avoided, and no claim of remembering in a turn that saved nothing
    const memoryCase = !!(exp.memory_after || exp.memory_absent || exp.memory_unchanged || exp.memory_count || c.sessions || c.memory)
    if (exp.memory_after || exp.memory_absent || exp.memory_unchanged || exp.memory_count) {
        const notes = out.memories ?? []
        const subjectOf = (m) => (m.kind === 'exercise' && m.subject ? idFor(m.subject) ?? m.subject : m.subject ?? null)
        // No subject key: any note of that kind (an other note's ID is made when it's saved).
        // text_includes ignores spaces: "3 月" and "3月" are the same
        const squash = (s) => String(s ?? '').replace(/\s+/g, '')
        const has = (m) => notes.some((n) => n.kind === m.kind && (!('subject' in m) || (n.subject ?? null) === subjectOf(m))
            && (!m.state || n.state === m.state) && (!m.text_includes || squash(n.text).includes(squash(m.text_includes))))
        const noteLabel = (m) => `${MEMORY_KIND_ZH[m.kind] ?? m.kind}${m.subject && m.kind !== 'other' ? `「${m.kind === 'injury' ? JOINT_ZH[m.subject] ?? m.subject : label(subjectOf(m))}」` : ''}${m.state ? `（${m.state}）` : ''}${m.text_includes ? `，內容有「${m.text_includes}」` : ''}`
        const problems = [
            ...(exp.memory_after ?? []).filter((m) => !has(m)).map((m) => `沒有記住：${noteLabel(m)}`),
            ...(exp.memory_absent ?? []).filter((m) => has(m)).map((m) => `不該記著卻記著：${noteLabel(m)}`),
            ...(exp.memory_unchanged && JSON.stringify(notes) !== JSON.stringify(out.memoriesBefore ?? []) ? ['不該改記憶卻改了'] : []),
            // How many notes of a kind there must be: a change replaced the old note instead of adding one
            ...Object.entries(exp.memory_count ?? {}).filter(([kind, n]) => notes.filter((x) => x.kind === kind).length !== n)
                .map(([kind, n]) => `${MEMORY_KIND_ZH[kind] ?? kind}應該有 ${n} 則，實際 ${notes.filter((x) => x.kind === kind).length} 則`),
        ]
        grade.memory_right = problems.length ? 0 : 1
        explanation.memory_right = problems.join('；') || '記憶符合預期'
    } else grade.memory_right = null

    if (exp.avoid) {
        // What the last day recommended: a recommendation card, or an exercise it added
        const last = Math.max(...out.turns.map((t) => t.session ?? 1))
        const lastTurns = out.turns.filter((t) => (t.session ?? 1) === last)
        const carded = lastTurns.flatMap((t) => t.toolCalls).filter((x) => x.name === 'recommend_exercise')
            .flatMap((x) => exercises.filter((e) => x.input?.exercise_id && e.id.startsWith(String(x.input.exercise_id).toLowerCase().slice(0, 8))).map((e) => e.id))
        const added = lastTurns.flatMap((t) => t.writes).filter((w) => w.op === 'add_today' && w.effective !== false).map((w) => w.exerciseId)
        const picked = [...new Set([...carded, ...added])]
        const banned = new Set((exp.avoid.exercises ?? []).map(idFor))
        const tooHard = (id) => exp.avoid.joint && LOAD_RANK[byId.get(id)?.joint_load?.[exp.avoid.joint] ?? 'none'] > LOAD_RANK[exp.avoid.max ?? 'low']
        const bad = picked.filter((id) => banned.has(id) || tooHard(id))
        grade.avoids_noted = picked.length && !bad.length ? 1 : 0
        explanation.avoids_noted = !picked.length ? '最後一天沒有推薦或加入任何動作'
            : bad.length ? `推薦了應該避開的動作：${bad.map(label).join('、')}`
            : `推薦的 ${picked.map(label).join('、')} 都避開了${exp.avoid.joint ? `${JOINT_ZH[exp.avoid.joint]}負擔高的動作` : '不喜歡的動作'}`
    } else grade.avoids_noted = null

    if (memoryCase) {
        const claims = out.turns.map((t, i) => [t, i + 1]).filter(([t]) => MEMORY_CLAIM.test(t.message) && !t.memoryChanged)
        grade.no_false_memory_claim = claims.length ? 0 : 1
        explanation.no_false_memory_claim = claims.length
            ? `第 ${claims.map(([, n]) => n).join('、')} 句說了記住，但記憶沒有任何改變`
            : '沒有說記住卻沒記'
    } else grade.no_false_memory_claim = null

    const fellBack = out.turns.filter((t) => !t.message.trim() || FALLBACKS.includes(t.message.trim()))
    grade.no_fallback = fellBack.length ? 0 : 1
    explanation.no_fallback = fellBack.length ? `有 ${fellBack.length} 句回覆是空的，或是「抱歉，請再問一次」（迴圈用完）` : '每句都有正常回覆'

    // The knowledge base: the sources code listed under the last reply (citations.ts) include a note
    // that answers the question; or, where no note does, none are listed and the reply is labelled
    // general advice; and no key the reply used was one it wasn't given
    if (exp.cites_any || exp.cites_none || exp.unsourced != null) {
        const last = out.turns.at(-1) ?? {}
        const dois = new Set((last.sources ?? []).map((src) => String(src.doi).toLowerCase()))
        const problems = []
        if (exp.cites_any && !exp.cites_any.some((id) => dois.has(NOTE_DOI.get(id)))) problems.push(`沒有引用 ${exp.cites_any.join('、')} 任何一篇`)
        if (exp.cites_none && dois.size) problems.push(`沒有相關研究卻附了 ${dois.size} 個出處`)
        if (exp.unsourced === true && !last.unsourced) problems.push('沒有標示「一般建議」')
        const unknown = out.turns.flatMap((t) => t.knowledgeCheck?.unknownKeys ?? [])
        if (unknown.length) problems.push(`引用了沒查到的條目 ${unknown.join('、')}（已被程式拿掉）`)
        grade.sourced = problems.length ? 0 : 1
        explanation.sourced = problems.join('；') || (dois.size ? `附了 ${dois.size} 個出處，包含該引用的研究` : '沒有附出處，並標示為一般建議')
    } else grade.sourced = null

    grade.language_correct = out.turns.every((t) => languageCorrect(t.message, c.language)) ? 1 : 0
    explanation.language_correct = grade.language_correct ? `回覆語言符合 ${c.language}` : `有回覆不是 ${c.language}（中文回覆也要用全形標點）`

    return { grade, explanation }
}

// Tracked but not part of the overall pass: an id the app rejected changed nothing,
// and what matters to the user (wrong or missed changes) is graded separately
const DIAGNOSTIC = new Set(['valid_ids'])

/** Every applicable check passed. */
export function overallPass(grade) {
    return Object.entries(grade).filter(([k, v]) => v != null && !DIAGNOSTIC.has(k)).every(([, v]) => v === 1) ? 1 : 0
}
