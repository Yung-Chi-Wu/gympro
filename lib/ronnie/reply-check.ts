// Checks a reply against the user's log before it's shown. A rule a program can check is checked
// here, not left to the prompt: replies kept calling an exercise still to come "already done"
// while reasoning about which muscles were trained (swap-question-only-zh, 8 of 22 runs across
// v27-v33), though the tool result listed it under "Not done yet".

/** One of today's exercises: every name it may be written as, and whether it has logged sets */
export interface LoggedToday {
    names: string[]
    done: boolean
}

// Saying it happened: "已經做過", "已經練了", "已完成", "都練過了", "今天做了"; "already did",
// "you've trained". Not "還沒做", "等你做完", "已經排了", "已經有".
const DONE_ZH = /(已經|已|剛剛|剛)(做|練|完成)|都(做|練)(過|了|完)|今天(做|練)(過|了)/
const DONE_EN = /\balready (did|done|trained|completed|finished|hit|worked)\b|\b(you've|you have|you) (already )?(done|did|trained|completed|finished)\b/i
// Equipment words a reply may leave out: "上斜臥推" for 上斜啞鈴臥推, "Incline Press" for Incline Dumbbell Press
const EQUIPMENT_ZH = /啞鈴|槓鈴|器械|機械|繩索|滑輪|史密斯|壺鈴/g
const EQUIPMENT_EN = /\b(dumbbell|barbell|machine|cable|smith|kettlebell|ez[- ]bar)\b\s*/gi

/** The names an exercise may be written as: its own, and without the equipment */
export function namesOf(names: (string | null | undefined)[]): string[] {
    const out = new Set<string>()
    for (const name of names) {
        if (!name?.trim()) continue
        out.add(name.trim())
        const zh = name.replace(EQUIPMENT_ZH, '').trim()
        if (zh.length >= 2) out.add(zh)
        const en = name.replace(EQUIPMENT_EN, '').replace(/\s+/g, ' ').trim()
        if (en.length >= 4) out.add(en)
    }
    return [...out]
}

/**
 * The exercises a reply says were done that have no sets today. Read clause by clause: a clause
 * that says something was done names what it means. A question is not a claim. Where one name
 * is inside a longer one ("臥推" in "上斜臥推"), the longer is what was written.
 */
export function doneClaims(reply: string, today: LoggedToday[]): string[] {
    const claimed = new Set<number>()
    const clauses = reply.split(/(?<=[。！？!?\n；;，,])/)
    for (const clause of clauses) {
        if (/[？?]\s*$/.test(clause) || /嗎|吗/.test(clause)) continue
        if (!DONE_ZH.test(clause) && !DONE_EN.test(clause)) continue
        // Every place a name appears, the longest name winning where they overlap
        const hits: { start: number; end: number; index: number }[] = []
        today.forEach((ex, index) => {
            for (const name of ex.names) {
                const lower = clause.toLowerCase()
                const needle = name.toLowerCase()
                for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
                    hits.push({ start: at, end: at + needle.length, index })
                }
            }
        })
        hits.sort((a, b) => (b.end - b.start) - (a.end - a.start))
        const taken: { start: number; end: number }[] = []
        for (const hit of hits) {
            if (taken.some((t) => hit.start < t.end && t.start < hit.end)) continue
            taken.push(hit)
            if (!today[hit.index].done) claimed.add(hit.index)
        }
    }
    return [...claimed].map((i) => today[i].names[0])
}

/** What the model is told when its reply needs fixing, before the user sees it */
export function doneClaimFeedback(names: string[]): string {
    return `[App check] Before your reply was shown, the app compared it with today's log. It says ${names.join(' and ')} ${names.length === 1 ? 'was' : 'were'} already done, but today's log has no sets of ${names.length === 1 ? 'it' : 'them'}: still to come. Write the reply again with that corrected, changing nothing else.`
}

/** Said under a reply that still claimed it after one try, in the code's words */
export function doneClaimCorrection(names: string[], zh: boolean): string {
    return zh ? `📌 更正：今天還沒有${names.join('、')}的紀錄。` : `📌 Correction: today's log has no sets of ${names.join(' or ')} yet.`
}
