import type { RuleId } from './types'

// The research behind each report rule. Citations live here, in code: the model never
// writes one. Each rule's claim is in messages (reportV3.researchText), worded to say no
// more than these papers do, then what GymPro does because of it. The report speaks with
// one voice: the papers explain GymPro's advice and never sit beside it as a second
// recommendation (a reader shown "GymPro: 10" next to "studies: 12-20" can't tell which
// to follow). Every DOI was resolved through LibKey on 2026-10-09 (the cardio papers on
// 2026-10-12); `npm run check:evidence` checks they still resolve and that every rule has a claim.
//
// ownThreshold: the rule's number (3 periods, -5%, -3%, 4 periods, 15 minutes) is GymPro's own
// setting, which no paper gives, and the report says so. The 10 weekly sets of low_volume are
// where Pelland's most efficient tier ends (below).

/** Weekly sets for a muscle below which growth isn't detectable yet: Pelland's minimum effective dose */
export const MIN_EFFECTIVE_WEEKLY_SETS = 4

export type Source = {
    /** First author's surname */
    author: string
    year: number
    title: string
    journal: string
    doi: string
    /** An organization's statement (ACSM), cited by its name alone, with no "et al." */
    organization?: true
}

/**
 * Cited by two rules and the glossary: volume and frequency against growth and strength, sets
 * counted fractionally. Its Table 2A (checked in the published version by the owner, 2026-10-13)
 * gives the growth tiers the low_volume rule and text use: 4 weekly sets is the minimum
 * effective dose; from 5 to 10, about 6 more sets give one more detectable step (2.05%); 11-18
 * take about 8.5, 19-29 about 10.75, 30-42 about 12.5; few studies go past about 25.
 */
const PELLAND: Source = { author: 'Pelland', year: 2026, title: 'The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains', journal: 'Sports Medicine', doi: '10.1007/s40279-025-02344-w' }

/** Cited by the cardio rule and the cardio facts: concurrent training against lifting alone, and the order within a session */
const HELD: Source = { author: 'Held', year: 2026, title: 'Maximizing Adaptations in Concurrent Training: An Umbrella Review of Meta-analyses', journal: 'Sports Medicine', doi: '10.1007/s40279-026-02401-y' }

// Next session (plan.ts), resolved through LibKey on 2026-10-21
/** Trained lifters, 8 weeks: adding reps at a fixed load grew muscle and strength about as well as adding load */
const PLOTKIN: Source = { author: 'Plotkin', year: 2022, title: 'Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations', journal: 'PeerJ', doi: '10.7717/peerj.14142' }
/** Progression: add 2-10% when the current load can be done for one or two reps more than the set calls for */
const ACSM_2009: Source = { author: 'ACSM', year: 2009, title: 'Progression Models in Resistance Training for Healthy Adults', journal: 'Medicine & Science in Sports & Exercise', doi: '10.1249/MSS.0b013e3181915670', organization: true }
/** Network meta-analysis: for strength, heavier loads (above about 80% of 1RM) ranked best */
const CURRIER_2023: Source = { author: 'Currier', year: 2023, title: 'Resistance training prescription for muscle strength and hypertrophy in healthy adults: a systematic review and Bayesian network meta-analysis', journal: 'British Journal of Sports Medicine', doi: '10.1136/bjsports-2023-106807' }
/** Position stand: for strength, train each muscle group two or more days a week */
const ACSM_2026: Source = { author: 'ACSM', year: 2026, title: 'American College of Sports Medicine Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews', journal: 'Medicine & Science in Sports & Exercise', doi: '10.1249/MSS.0000000000003897', organization: true }
/** More sessions a week, more strength, mostly through the added volume */
const GRGIC_2018: Source = { author: 'Grgic', year: 2018, title: 'Effect of Resistance Training Frequency on Gains in Muscular Strength: A Systematic Review and Meta-Analysis', journal: 'Sports Medicine', doi: '10.1007/s40279-018-0872-x' }
/** College men: lat-pull 1RM about 75-80% of the pull-up 1RM (body plus added load); r = 0.78 */
const JOHNSON_2009: Source = { author: 'Johnson', year: 2009, title: 'Relationship of Lat-Pull Repetitions and Pull-Ups to Maximal Lat-Pull and Pull-Up Strength in Men and Women', journal: 'Journal of Strength and Conditioning Research', doi: '10.1519/JSC.0b013e3181a2d7f5' }

/**
 * Each part of a next-session plan and its research (messages: reportV3.planResearch): the
 * double progression every plan starts from, heavier sets for a strength goal, a second day of a
 * lift trained once, and the pulldown as the way to a first pull-up.
 */
export const PLAN_EVIDENCE = {
    progress: [PLOTKIN, ACSM_2009],
    heavy: [CURRIER_2023],
    frequency: [ACSM_2026, GRGIC_2018],
    pullUp: [JOHNSON_2009],
} satisfies Record<string, Source[]>
export type PlanPart = keyof typeof PLAN_EVIDENCE

/** safety: a rule that protects the user rather than follows a study; it has no paper, and its claim says so */
export const EVIDENCE: Record<RuleId, { sources: Source[]; ownThreshold: boolean; safety?: true }> = {
    lift_stalled: {
        sources: [PLOTKIN],
        ownThreshold: true,
    },
    goal_path: {
        sources: [PLOTKIN, ACSM_2009, CURRIER_2023, ACSM_2026, GRGIC_2018, JOHNSON_2009],
        ownThreshold: false,
    },
    next_session: {
        sources: [PLOTKIN, ACSM_2009],
        ownThreshold: false,
    },
    // A safety rule, not a study's result: the claim says so
    pain_hold: {
        sources: [],
        ownThreshold: false,
        safety: true,
    },
    lift_regressed: {
        sources: [
            // A short-term drop that recovery reverses is functional overreaching; prolonged maladaptation is the warning
            { author: 'Meeusen', year: 2013, title: 'Prevention, diagnosis, and treatment of the overtraining syndrome: joint consensus statement of the European College of Sport Science and the American College of Sports Medicine', journal: 'Medicine & Science in Sports & Exercise', doi: '10.1249/MSS.0b013e318279a10a' },
        ],
        ownThreshold: true,
    },
    deload: {
        sources: [
            // Coaches' consensus: deloading rests mostly on experience; it can be planned or used when fatigue shows
            { author: 'Bell', year: 2023, title: 'Integrating Deloading into Strength and Physique Sports Training Programmes: An International Delphi Consensus Approach', journal: 'Sports Medicine - Open', doi: '10.1186/s40798-023-00633-0' },
            // A scheduled week off at the midpoint of 9 weeks: same muscle growth, smaller lower-body strength gains
            { author: 'Coleman', year: 2024, title: 'Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations', journal: 'PeerJ', doi: '10.7717/peerj.16777' },
        ],
        ownThreshold: true,
    },
    low_volume: {
        sources: [
            // More weekly sets, more growth (graded dose-response): +0.37% per set; the <5 / 5-9 / 10+
            // split was only a trend (P = 0.074), so it is not where GymPro's 10 comes from
            { author: 'Schoenfeld', year: 2017, title: 'Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis', journal: 'Journal of Sports Sciences', doi: '10.1080/02640414.2016.1210197' },
            // Growth keeps rising with volume, with diminishing returns: the tiers above
            PELLAND,
            // Young trained men: 12-20 weekly sets did as well as more than 20 for quads and biceps
            { author: 'Baz-Valle', year: 2022, title: 'A Systematic Review of The Effects of Different Resistance Training Volumes on Muscle Hypertrophy', journal: 'Journal of Human Kinetics', doi: '10.2478/hukin-2022-0017' },
        ],
        ownThreshold: false,
    },
    missed_sessions: {
        sources: [
            // With volume equated, frequency does not meaningfully change muscle growth
            { author: 'Schoenfeld', year: 2019, title: 'How many times per week should a muscle be trained to maximize muscle hypertrophy? A systematic review and meta-analysis of studies examining the effects of resistance training frequency', journal: 'Journal of Sports Sciences', doi: '10.1080/02640414.2018.1555906' },
            // Frequency: negligible for growth, but strength rises with it (diminishing returns)
            PELLAND,
        ],
        ownThreshold: false,
    },
    weight_trend: {
        sources: [
            // Fat loss: a deficit that loses about 0.5-1% of body weight a week keeps the most muscle
            { author: 'Helms', year: 2014, title: 'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation', journal: 'Journal of the International Society of Sports Nutrition', doi: '10.1186/1550-2783-11-20' },
            // Muscle gain: a surplus likely helps, but no controlled trial has set how much
            { author: 'Slater', year: 2019, title: 'Is an Energy Surplus Required to Maximize Skeletal Muscle Hypertrophy Associated With Resistance Training', journal: 'Frontiers in Nutrition', doi: '10.3389/fnut.2019.00131' },
        ],
        ownThreshold: true,
    },
    cardio_first: {
        sources: [
            // Ten studies, 5+ weeks: resistance then endurance in one session, +6.9% lower-body dynamic strength; no difference in lower-body growth
            { author: 'Eddens', year: 2018, title: 'The Role of Intra-Session Exercise Sequence in the Interference Effect: A Systematic Review with Meta-Analysis', journal: 'Sports Medicine', doi: '10.1007/s40279-017-0784-1' },
            // Strength before endurance in the same session: lower-body 1RM 3.96 kg higher; aerobic capacity the same either way
            { author: 'Murlasits', year: 2018, title: 'The physiological effects of concurrent strength and endurance training sequence: A systematic review and meta-analysis', journal: 'Journal of Sports Sciences', doi: '10.1080/02640414.2017.1364405' },
            // Across meta-analyses the order was not significant, with a trend toward lifting first for strength
            HELD,
        ],
        ownThreshold: true,
    },
}

/**
 * The research behind the cardio facts, which give no advice: cardio alongside lifting doesn't
 * hold back muscle growth or maximal strength (messages: reportV3.cardio.researchText), and
 * WHO's weekly amount of aerobic activity (reportV3.cardio.who).
 */
export const CARDIO_EVIDENCE: { research: Source[]; who: Source[] } = {
    research: [
        // 43 studies: concurrent training against the same lifting alone, no difference in hypertrophy or maximal strength; explosive strength blunted, more so in the same session
        { author: 'Schumann', year: 2022, title: 'Compatibility of Concurrent Aerobic and Strength Training for Skeletal Muscle Size and Function: An Updated Systematic Review and Meta-Analysis', journal: 'Sports Medicine', doi: '10.1007/s40279-021-01587-7' },
        // 17 meta-analyses: strength and hypertrophy comparable to lifting alone, aerobic capacity better
        HELD,
    ],
    who: [
        // Adults: 150-300 minutes of moderate aerobic activity a week, or 75-150 vigorous, counting all of daily life
        { author: 'Bull', year: 2020, title: 'World Health Organization 2020 guidelines on physical activity and sedentary behaviour', journal: 'British Journal of Sports Medicine', doi: '10.1136/bjsports-2020-102955' },
    ],
}

/**
 * The research behind the goal section (reportV3.goal), which measures how far a goal is and
 * gives no advice. Resolved through LibKey on 2026-10-20.
 */
export const GOAL_EVIDENCE: { e1rm: Source[]; pullUp: Source[]; bodyWeight: Source[] } = {
    e1rm: [
        // A 1RM is predicted best from a heavy set of a few reps; the linear equations shouldn't be used past 10
        { author: 'Reynolds', year: 2006, title: 'Prediction of One Repetition Maximum Strength From Multiple Repetition Maximum Testing and Anthropometry', journal: 'Journal of Strength and Conditioning Research', doi: '10.1519/R-15304.1' },
    ],
    // College men: lat-pull 1RM 0.93 x body mass against a pull-up 1RM (body plus added load) of 1.16 x; r = 0.78.
    // The lat pull was about 75-80% of the pull-up. Where a first pull-up falls is GymPro's reading of that ratio, not a result of the study.
    pullUp: [JOHNSON_2009],
    bodyWeight: [
        // Elite athletes: losing about 0.7% of body weight a week kept and gained lean mass; 1.4% a week didn't
        { author: 'Garthe', year: 2011, title: 'Effect of Two Different Weight-Loss Rates on Body Composition and Strength and Power-Related Performance in Elite Athletes', journal: 'International Journal of Sport Nutrition and Exercise Metabolism', doi: '10.1123/ijsnem.21.2.97' },
        // A review's range: 0.5-1% of body weight a week
        { author: 'Helms', year: 2014, title: 'Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation', journal: 'Journal of the International Society of Sports Nutrition', doi: '10.1186/1550-2783-11-20' },
    ],
}

/** The research behind a glossary entry: counting a secondary muscle's set as half fit the studies best of the methods compared */
export const GLOSSARY_SOURCES: Partial<Record<string, Source[]>> = {
    weeklySets: [PELLAND],
}
