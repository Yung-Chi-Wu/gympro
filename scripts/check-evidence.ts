// Free check of the report's research table (lib/report/evidence.ts): every rule has at
// least one paper and a claim in both languages, and every DOI still resolves at doi.org.
// Run: npm run check:evidence

import en from '../messages/en.json'
import zh from '../messages/zh-TW.json'
import { EVIDENCE } from '../lib/report/evidence'

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
    }

    const dois = new Set<string>()
    for (const rule of rules) {
        const { sources } = EVIDENCE[rule]
        if (!sources.length) problems.push(`${rule}: no source`)
        for (const s of sources) {
            if (!DOI.test(s.doi)) problems.push(`${rule}: malformed DOI ${s.doi}`)
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
