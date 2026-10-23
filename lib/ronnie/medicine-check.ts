// A reply that touches on a medicine always leaves the decision to a doctor or pharmacist. The
// prompt's medicine rule (MEDICINE_RULE, prompt.ts) asks for that, along with no advice on whether,
// when, how much or how often to take one (owner, 2026-10-23: "不要給建議 但可以給理論"). Code can
// check the referral, so code guarantees it: a reply that names no doctor or pharmacist gets the line
// under it (medicineNote), in the code's words.
//
// Advice itself isn't checked by a model. Read for it over the 48 saved medicine replies of evals
// v34-v37, Haiku 4.5 caught 9 of 10 and 9 of 11 with two prompts, missing different sentences each
// time, and flagged 2 and 4 replies that gave none ("I can't give you a dose"). Sonnet 5.5 caught all
// 11 but flagged 18 of the other 37, among them "natural training can get you there" for steroids and
// "pushing through pain is a bad idea". Each flag costs a rewrite. With the rule, 11 of 12 fresh
// replies gave no advice (v37); the owner chose this line over a check that rewrites half of them.

/**
 * A medicine named in the question or the reply: 藥 (not 藥球, a medicine ball), drug names and
 * kinds in both languages. Supplements (creatine, caffeine, protein) are not medicines here.
 */
const MEDICINE_ZH = /藥(?!球)|布洛芬|普拿疼|阿斯匹靈|乙醯胺酚|類固醇|睪固酮|褪黑激素|止痛劑|鬆弛劑|安眠/
const MEDICINE_EN = /\bmedicines?\b(?!\s+balls?)|\bmedications?\b|\bdrugs?\b|\bpills?\b|\bpainkillers?\b|\bpain ?relievers?\b|\bnsaids?\b|\bibuprofen\b|\badvil\b|\bmotrin\b|\bnaproxen\b|\baleve\b|\baspirin\b|\bacetaminophen\b|\bparacetamol\b|\btylenol\b|\bdiclofenac\b|\bvoltaren\b|\bcelecoxib\b|\bsteroids?\b|\banabolic\b|\btestosterone\b|\bprednisone\b|\bcortisone\b|\bmelatonin\b|\bopioids?\b|\btramadol\b|\bmuscle relaxants?\b|\bsedatives?\b/i
export const mentionsMedicine = (text: string) => MEDICINE_ZH.test(text) || MEDICINE_EN.test(text)

/** Sends them to someone who may decide: the rule asks for a doctor or pharmacist */
const REFERRAL = /醫師|醫生|藥師|就醫|看診|\bdoctors?\b|\bpharmacists?\b|\bphysicians?\b|\bGP\b/i
export const refersToDoctor = (text: string) => REFERRAL.test(text)

/** Said under a reply about a medicine that sends them to no doctor or pharmacist */
export function medicineNote(zh: boolean): string {
    return zh
        ? '💊 要不要吃藥、什麼時候吃、吃多少，請問醫師或藥師。羅尼只說明研究和原理，不給用藥建議。'
        : '💊 Whether, when and how much to take a medicine is for a doctor or pharmacist to decide. Ronnie explains the research and how it works, not what to take.'
}
