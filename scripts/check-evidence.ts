// Free check of the report's research table (lib/report/evidence.ts): every rule has at
// least one paper (a safety rule none, its claim saying so) and a claim in both languages, the
// cardio facts and each part of a next-session plan too, and every DOI (rules, plan parts,
// glossary, cardio) still resolves at doi.org.
// Run: npm run check:evidence

import en from '../messages/en.json'
import zh from '../messages/zh-TW.json'
import { CARDIO_EVIDENCE, EVIDENCE, GLOSSARY_SOURCES, GOAL_EVIDENCE, PLAN_EVIDENCE } from '../lib/report/evidence'

const DOI = /^10\.\d{4,9}\/\S+$/

async function resolves(doi: string): Promise<boolean> {
    // The DOI handle API answers responseCode 1 for a registered DOI, without following it to the publisher
    const res = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi)}`)
    if (!res.ok) return false
    const body = (await res.json()) as { responseCode?: number }
    return body.responseCode === 1
}

async function main() {
    const problems: string[] = []
    const rules = Object.keys(EVIDENCE) as (keyof typeof EVIDENCE)[]
    for (const [lang, messages] of [['en', en], ['zh-TW', zh]] as const) {
        const claims: Record<string, string> = messages.reportV3.researchText
        for (const rule of rules) if (!claims[rule]?.trim()) problems.push(`${lang}: no researchText for ${rule}`)
        for (const key of Object.keys(claims)) if (!(key in EVIDENCE)) problems.push(`${lang}: researchText.${key} has no rule`)
        for (const key of ['researchText', 'who', 'intensityText', 'trendText'] as const) if (!messages.reportV3.cardio[key]?.trim()) problems.push(`${lang}: no cardio.${key}`)
        const plan: Record<string, string> = messages.reportV3.planResearch
        for (const part of Object.keys(PLAN_EVIDENCE)) if (!plan[part]?.trim()) problems.push(`${lang}: no planResearch for ${part}`)
        // A safety rule's claim says it is one, so it never reads as a study's result
        for (const rule of rules) if (EVIDENCE[rule].safety && !/安全原則|safety rule/.test(claims[rule] ?? '')) problems.push(`${lang}: researchText.${rule} doesn't say it is a safety rule`)
    }

    const dois = new Set<string>()
    for (const rule of rules) {
        const { sources } = EVIDENCE[rule]
        if (!sources.length && !EVIDENCE[rule].safety) problems.push(`${rule}: no source`)
        for (const s of sources) {
            if (!DOI.test(s.doi)) problems.push(`${rule}: malformed DOI ${s.doi}`)
            else dois.add(s.doi)
        }
    }
    const cardio = [
        ...Object.entries(CARDIO_EVIDENCE).map(([k, sources]) => [`cardio ${k}`, sources] as const),
        ...Object.entries(GOAL_EVIDENCE).map(([k, sources]) => [`goal ${k}`, sources] as const),
        ...Object.entries(PLAN_EVIDENCE).map(([k, sources]) => [`plan ${k}`, sources] as const),
    ]
    for (const [entry, sources] of cardio) if (!sources.length) problems.push(`${entry}: no source`)
    for (const [entry, sources] of [...Object.entries(GLOSSARY_SOURCES), ...cardio]) {
        for (const s of sources ?? []) {
            if (!DOI.test(s.doi)) problems.push(`${entry}: malformed DOI ${s.doi}`)
            else dois.add(s.doi)
        }
    }
    for (const doi of dois) {
        if (!(await resolves(doi))) problems.push(`DOI does not resolve: ${doi}`)
    }

    if (problems.length) {
        console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
        process.exit(1)
    }
    console.log(`ok: ${rules.length} rules, ${dois.size} DOIs resolve, claims in en and zh-TW`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
