import { MAX_TRAINING_GOAL_CHARS } from './text-limits'

/** Settings, open at the goal */
export const GOAL_SETTING = '/settings?item=trainingGoal'

// The kinds the report's goal reader knows (lib/report/goal-reader.ts GOAL_KINDS), in
// words it reads as them. Picked ones become the start of training_goal, which stays free text
export const GOAL_CHOICES = [
    { key: 'muscle', zh: '增肌', en: 'Muscle' },
    { key: 'strength', zh: '力量', en: 'Strength' },
    { key: 'fat_loss', zh: '減脂', en: 'Fat loss' },
    { key: 'physique', zh: '體態', en: 'Physique' },
    { key: 'health', zh: '健康', en: 'Health' },
    { key: 'endurance', zh: '耐力', en: 'Endurance' },
] as const

/** The goal as one text: the kinds picked, then the user's own words ("增肌、力量。深蹲 140 kg") */
export function goalText(kinds: string[], words: string, zh: boolean): string {
    const names = GOAL_CHOICES.filter((c) => kinds.includes(c.key)).map((c) => (zh ? c.zh : c.en))
    const own = words.trim()
    const picked = names.join(zh ? '、' : ', ')
    const text = picked && own ? `${picked}${zh ? '。' : '. '}${own}` : picked || own
    return text.slice(0, MAX_TRAINING_GOAL_CHARS)
}
