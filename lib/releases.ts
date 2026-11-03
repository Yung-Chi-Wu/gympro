// 最近更新: what each big update brought, newest first. Today opens the newest once after it ships
// (lib/today-overlay.ts, components/WhatsNew.tsx), and Settings lists them all. An entry is added
// by hand, for a big update only (owner, 2026-11-02), with its words in both languages side by
// side, and every item says where in the app it is (owner, 2026-11-03). Items gather in
// NEXT_ITEMS as their features ship; scripts/check-today-overlay.ts checks every entry and them.

/** The small drawing beside an item, of the feature itself (components/WhatsNew.tsx draws each) */
export type ReleaseArt = 'medal' | 'weeks'

/** A short name and one sentence of what it does, as Apple's own apps write theirs, and where it is */
export interface ReleaseItem {
    art: ReleaseArt
    title: { en: string; zh: string }
    body: { en: string; zh: string }
    /** Where in the app, in the names its menus and tabs show (今天, 紀錄 → 成就) */
    where: { en: string; zh: string }
}

export interface Release {
    /** The day it shipped (YYYY-MM-DD) */
    date: string
    items: ReleaseItem[]
}

/** At most this many items an entry: people keep about four things in mind at once (Cowan 2001) */
export const RELEASE_ITEMS_MAX = 3
/** Entries this many days apart or more, so the popup stays rare: a dialog seen often is soon closed unread (Anderson et al. 2016) */
export const RELEASE_MIN_DAYS = 7

export const RELEASES: Release[] = [
    {
        date: '2026-11-03',
        items: [
            {
                art: 'medal',
                title: { en: 'Awards', zh: '成就' },
                body: {
                    en: 'Bronze, silver and gold for your main lifts and for keeping at it, and a note the day after you earn one.',
                    zh: '主要動作和持續練習都有銅、銀、金牌，拿到新的隔天會恭喜你。',
                },
                where: { en: 'History → Awards', zh: '紀錄 → 成就' },
            },
            {
                art: 'weeks',
                title: { en: 'Last week, recapped', zh: '上週回顧' },
                body: {
                    en: 'The days you trained and your new bests, one tap from the full report.',
                    zh: '先看上週練了幾天、破了哪些紀錄，再一鍵看完整週報。',
                },
                where: { en: 'Today, on Mondays', zh: '今天（每週一）' },
            },
        ],
    },
]

/**
 * The next entry, gathered as features ship so none is forgotten (owner, 2026-11-03): the PR that
 * brings something users will see or use adds its item here, while it is fresh; fixes, speed and
 * wording don't. Nothing here is shown. With 2 or 3 items, or one big one, it gets a date and
 * moves into RELEASES; a 4th fails the check until then.
 */
export const NEXT_ITEMS: ReleaseItem[] = []

/**
 * The newest entry, when the user hasn't seen it: shipped by today, after their account was made
 * (an account made since has nothing to catch up on), and newer than the last one they saw
 * (user_profiles.release_seen). Only the newest: the ones before it are in Settings.
 */
export function dueRelease(releases: Release[], { seen, joined, today }: { seen: string | null; joined: string | null; today: string }): Release | null {
    const newest = releases[0]
    if (!newest || newest.date > today) return null
    if (joined !== null && joined >= newest.date) return null
    if (seen !== null && seen >= newest.date) return null
    return newest
}
