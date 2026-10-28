import { readFileSync, writeFileSync } from 'node:fs'
import { CARDIO_LOG_TYPES, EQUIPMENT, JOINTS, LEVELS, LOG_TYPE_IDS, MUSCLE_IDS, MUSCLES, type Equipment, type Joint, type Level, type LogType, type Muscle } from '../lib/exercise-attributes'

// The built-in exercises live in supabase/data/exercise-attributes.json, reviewed by hand: names,
// muscle group, equipment, muscles, stability demand, joint load, how sets are logged, and
// whether a set is logged for one side. This checks that file against the vocabularies. With
// --migration <path> it writes the SQL that brings the database to it (one DO block, for the
// SQL Editor) and then rewrites evals/search/library.csv, which is the library as the
// migrations leave it. Adding an exercise is one row in the JSON, with a new id (uuidgen):
//   npm run exercise-attributes -- --migration supabase/migrations/<name>.sql
// Without --migration, in CI, it fails when the JSON has changes no migration was written for.

interface Row {
    id: string
    name: string
    nameZh: string
    muscleGroup: string
    equipment: Equipment
    primary: Muscle[]
    secondary: Muscle[]
    stability: Level
    jointLoad: Record<Joint, Level>
    logType: LogType
    /** Done one side at a time: a set is one side's numbers, and both sides done count once */
    perSide?: true
}

const rows: Row[] = JSON.parse(readFileSync('supabase/data/exercise-attributes.json', 'utf8'))
const LIBRARY = 'evals/search/library.csv'
const LIBRARY_HEADER = 'id,name,name_zh_tw,muscle_group,equipment'
const library = readFileSync(LIBRARY, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))
const current = new Map(library.map(([id, name, nameZh, group, equipment]) => [id, { name, nameZh, group, equipment }]))

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
    if (!EQUIPMENT.includes(r.equipment)) problems.push(`${r.name}: equipment ${r.equipment}`)
    if ([r.name, r.nameZh].some((n) => n.includes(','))) problems.push(`${r.name}: a comma in a name, which the library file can't hold`)
    if (r.perSide !== undefined && r.perSide !== true) problems.push(`${r.name}: perSide is true or left out`)
    // Cardio machines are logged as cardio, and only cardio exercises are (a burpee is cardio but counted in reps)
    if (CARDIO_LOG_TYPES.includes(r.logType) && r.muscleGroup !== 'cardio') problems.push(`${r.name}: a cardio log type outside cardio`)
    const joints = Object.keys(r.jointLoad ?? {})
    if (joints.length !== JOINTS.length || JOINTS.some((j) => !LEVELS.includes(r.jointLoad[j]))) problems.push(`${r.name}: joint load ${JSON.stringify(r.jointLoad)}`)
}
const ids = new Set(rows.map((r) => r.id))
for (const [id, name] of library) if (!ids.has(id)) problems.push(`${name}: in the library but not in the data (removing one is not supported)`)
if (ids.size !== rows.length) problems.push('an exercise is listed twice')
for (const n of ['name', 'nameZh'] as const) {
    const seen = new Map<string, string>()
    for (const r of rows) {
        const key = r[n].toLowerCase()
        if (seen.has(key)) problems.push(`${r.name}: the same ${n} as ${seen.get(key)}`)
        seen.set(key, r.name)
    }
}
// New exercises, and ones whose name, group or equipment changed, since the last migration
const changed = rows.filter((r) => {
    const now = current.get(r.id)
    return !now || now.name !== r.name || now.nameZh !== r.nameZh || now.group !== r.muscleGroup || now.equipment !== r.equipment
})
const at = process.argv.indexOf('--migration')
if (changed.length && at < 0) problems.push(`${changed.map((r) => r.name).join(', ')}: changed with no migration; run npm run exercise-attributes -- --migration supabase/migrations/<name>.sql`)

if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
}
console.log(`${rows.length} exercises: every value in its vocabulary, every library exercise covered`)

if (at > 0) {
    const path = process.argv[at + 1]
    writeFileSync(path, migration(rows, current))
    writeFileSync(LIBRARY, [LIBRARY_HEADER, ...rows.map((r) => [r.id, r.name, r.nameZh, r.muscleGroup, r.equipment].join(','))].join('\n') + '\n')
    console.log(`Wrote ${path} (${changed.length} new or changed: ${changed.map((r) => r.name).join(', ') || 'none'}) and ${LIBRARY}`)
}

/** The SQL. Names and categories are only written where the data changes them. */
function migration(rows: Row[], current: Map<string, { name: string; nameZh: string; group: string; equipment: string }>): string {
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
    const array = (a: string[]) => `${quote(`{${a.join(',')}}`)}::text[]`
    const values = rows.map((r) =>
        `        -- ${r.name}\n        (${quote(r.id)}, ${array(r.primary)}, ${array(r.secondary)}, ${quote(r.stability)}, ${quote(JSON.stringify(r.jointLoad))}::jsonb, ${quote(r.logType)}, ${r.perSide ? 'true' : 'false'})`
    ).join(',\n')
    const inserts = rows.map((r) =>
        `        (${quote(r.id)}, ${quote(r.name)}, ${quote(r.nameZh)}, ${quote(r.muscleGroup)}, ${quote(r.equipment)}, false)`
    ).join(',\n')
    // Each only where the value is still the old one, so a second run changes nothing
    const renames = rows.flatMap((r) => {
        const now = current.get(r.id)
        if (!now) return []
        const update = (column: string, to: string, from: string) =>
            to !== from ? [`    update exercises set ${column} = ${quote(to)} where id = ${quote(r.id)} and ${column} = ${quote(from)};`] : []
        return [
            ...update('name', r.name, now.name),
            ...update('name_zh_tw', r.nameZh, now.nameZh),
            ...update('muscle_group', r.muscleGroup, now.group),
            ...update('equipment', r.equipment, now.equipment),
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

    -- Renamed exercises, ones moved to the category of their primary muscles, and new equipment.
    -- Before the new ones, so a new exercise can take the name an old one gives up
${renames}

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
