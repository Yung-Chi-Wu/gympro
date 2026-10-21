import { readFileSync, writeFileSync } from 'node:fs'
import { CARDIO_LOG_TYPES, JOINTS, LEVELS, LOG_TYPE_IDS, MUSCLE_IDS, MUSCLES, type Joint, type Level, type LogType, type Muscle } from '../lib/exercise-attributes'

// The built-in exercises' attributes (muscles, stability demand, joint load, how sets are
// logged, whether a set is logged for one side) live in supabase/data/exercise-attributes.json, reviewed by hand. This checks
// that file against the vocabularies and the library (evals/search/library.csv), and with
// --migration <path> writes the SQL that applies it (one DO block, for the SQL Editor). An
// exercise added to both files is inserted, so the library grows through this script too:
//   npm run exercise-attributes [-- --migration supabase/migrations/<name>.sql]

interface Row {
    id: string
    name: string
    nameZh: string
    muscleGroup: string
    primary: Muscle[]
    secondary: Muscle[]
    stability: Level
    jointLoad: Record<Joint, Level>
    logType: LogType
    /** Done one side at a time: a set is one side's numbers, and both sides done count once */
    perSide?: true
}

const rows: Row[] = JSON.parse(readFileSync('supabase/data/exercise-attributes.json', 'utf8'))
const library = readFileSync('evals/search/library.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))

const problems: string[] = []
const known = new Set<string>(MUSCLE_IDS)
for (const r of rows) {
    const bad = [...r.primary, ...r.secondary].filter((m) => !known.has(m))
    if (bad.length) problems.push(`${r.name}: not in the vocabulary: ${bad.join(', ')}`)
    if (!r.primary.length) problems.push(`${r.name}: no primary muscle`)
    const both = r.primary.filter((m) => r.secondary.includes(m))
    if (both.length) problems.push(`${r.name}: both primary and secondary: ${both.join(', ')}`)
    if (!LEVELS.includes(r.stability)) problems.push(`${r.name}: stability ${r.stability}`)
    // The app's category must be where the exercise's main muscles are: the review caught
    // Deadlift listed under back while its primary muscles are glutes and hamstrings
    const groups = r.primary.map((m) => MUSCLES[m]?.group).filter((g): g is NonNullable<typeof g> => !!g)
    if (groups.length && !(groups as string[]).includes(r.muscleGroup)) problems.push(`${r.name}: listed under ${r.muscleGroup}, but its primary muscles are in ${[...new Set(groups)].join(', ')}`)
    if (!LOG_TYPE_IDS.includes(r.logType)) problems.push(`${r.name}: log type ${r.logType}`)
    if (r.perSide !== undefined && r.perSide !== true) problems.push(`${r.name}: perSide is true or left out`)
    // Cardio machines are logged as cardio, and only cardio exercises are (a burpee is cardio but counted in reps)
    if (CARDIO_LOG_TYPES.includes(r.logType) && r.muscleGroup !== 'cardio') problems.push(`${r.name}: a cardio log type outside cardio`)
    const joints = Object.keys(r.jointLoad ?? {})
    if (joints.length !== JOINTS.length || JOINTS.some((j) => !LEVELS.includes(r.jointLoad[j]))) problems.push(`${r.name}: joint load ${JSON.stringify(r.jointLoad)}`)
}
const ids = new Set(rows.map((r) => r.id))
for (const [id, name] of library) if (!ids.has(id)) problems.push(`${name}: in the library but not in the data`)
if (ids.size !== rows.length) problems.push('an exercise is listed twice')
if (rows.length !== library.length) problems.push(`${rows.length} rows, library has ${library.length}`)

if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
}
console.log(`${rows.length} exercises: every muscle in the vocabulary, every library exercise covered`)

const at = process.argv.indexOf('--migration')
if (at > 0) {
    const path = process.argv[at + 1]
    writeFileSync(path, migration(rows, new Map(library.map(([id, , nameZh, group, equipment]) => [id, { nameZh, group, equipment }]))))
    console.log(`Wrote ${path}`)
}

/** The SQL. Names and categories are only written where the data changes them. */
function migration(rows: Row[], current: Map<string, { nameZh: string; group: string; equipment: string }>): string {
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
    const array = (a: string[]) => `${quote(`{${a.join(',')}}`)}::text[]`
    const values = rows.map((r) =>
        `        -- ${r.name}\n        (${quote(r.id)}, ${array(r.primary)}, ${array(r.secondary)}, ${quote(r.stability)}, ${quote(JSON.stringify(r.jointLoad))}::jsonb, ${quote(r.logType)}, ${r.perSide ? 'true' : 'false'})`
    ).join(',\n')
    const inserts = rows.map((r) =>
        `        (${quote(r.id)}, ${quote(r.name)}, ${quote(r.nameZh)}, ${quote(r.muscleGroup)}, ${quote(current.get(r.id)!.equipment)}, false)`
    ).join(',\n')
    const renames = rows.flatMap((r) => {
        const now = current.get(r.id)!
        return [
            ...(r.nameZh !== now.nameZh ? [`    update exercises set name_zh_tw = ${quote(r.nameZh)} where id = ${quote(r.id)} and name_zh_tw = ${quote(now.nameZh)};`] : []),
            ...(r.muscleGroup !== now.group ? [`    update exercises set muscle_group = ${quote(r.muscleGroup)} where id = ${quote(r.id)} and muscle_group = ${quote(now.group)};`] : []),
        ]
    }).join('\n')
    const vocabulary = `array[${MUSCLE_IDS.map(quote).join(', ')}]::text[]`
    return `-- Each built-in exercise's primary and secondary muscles, stability demand, joint load,
-- how its sets are logged and whether a set is one side's (per_side). Generated by
-- scripts/exercise-attributes.ts from supabase/data/exercise-attributes.json; edit the JSON,
-- not this file. Applied by hand in the SQL Editor.
--
-- Values come from the fixed vocabularies in lib/exercise-attributes.ts, enforced by
-- check constraints. Custom exercises keep empty muscle arrays (and fall back to
-- muscle_group) and are logged as weight x reps, both sides at once.
--
-- It is one DO block, so it applies all or nothing, and it is safe to run twice.

do $$
declare
    v_missing int;
begin
    alter table exercises add column if not exists primary_muscles text[] not null default '{}';
    alter table exercises add column if not exists secondary_muscles text[] not null default '{}';
    alter table exercises add column if not exists stability_demand text;
    alter table exercises add column if not exists joint_load jsonb;
    alter table exercises add column if not exists log_type text not null default 'weight_reps';
    alter table exercises add column if not exists per_side boolean not null default false;

    alter table exercises drop constraint if exists exercises_muscles_known;
    alter table exercises add constraint exercises_muscles_known check (
        primary_muscles <@ ${vocabulary}
        and secondary_muscles <@ ${vocabulary}
    );
    alter table exercises drop constraint if exists exercises_stability_demand_known;
    alter table exercises add constraint exercises_stability_demand_known check (stability_demand in ('low', 'medium', 'high'));
    alter table exercises drop constraint if exists exercises_log_type_known;
    alter table exercises add constraint exercises_log_type_known check (log_type in (${LOG_TYPE_IDS.map(quote).join(', ')}));

    -- Built-in exercises the database doesn't have yet; one it has is left as it is
    insert into exercises (id, name, name_zh_tw, muscle_group, equipment, is_custom)
    values
${inserts}
    on conflict (id) do nothing;
    select count(*) into v_missing from exercises
    where id = any (array[${rows.map((r) => quote(r.id)).join(', ')}]::uuid[]);
    if v_missing <> ${rows.length} then
        raise exception 'the library has % of its ${rows.length} exercises after adding the new ones', v_missing;
    end if;

    update exercises e
    set primary_muscles = v.primary_muscles,
        secondary_muscles = v.secondary_muscles,
        stability_demand = v.stability_demand,
        joint_load = v.joint_load,
        log_type = v.log_type,
        per_side = v.per_side
    from (values
${values}
    ) as v (id, primary_muscles, secondary_muscles, stability_demand, joint_load, log_type, per_side)
    where e.id = v.id::uuid;

    -- Renamed exercises, and ones moved to the category of their primary muscles
${renames}

    select count(*) into v_missing from exercises
    where not coalesce(is_custom, false) and cardinality(primary_muscles) = 0;
    if v_missing > 0 then
        raise exception '% built-in exercises have no primary muscle; the library changed since the data was written', v_missing;
    end if;
    select count(*) into v_missing from exercises
    where not coalesce(is_custom, false) and not coalesce(joint_load ?& array[${JOINTS.map(quote).join(', ')}], false);
    if v_missing > 0 then
        raise exception '% built-in exercises lack a joint''s load', v_missing;
    end if;
end
$$;
`
}
