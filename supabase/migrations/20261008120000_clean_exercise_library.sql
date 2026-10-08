-- Cleans up the built-in exercise library. Applied by hand in the SQL Editor.
--
-- Building the exercise-search eval turned up:
--   - Duplicate exercises: Barbell Curl and Barbell Bicep Curl were both 槓鈴彎舉.
--   - Chinese names that didn't match the English: Close-Grip Bench Press was 啞鈴彎舉,
--     so a search for 啞鈴彎舉 found a bench press.
--   - Muscle groups that disagreed between variants of the same exercise.
--   - Equipment written in mixed case.
-- It also adds 19 common exercises the library lacked.
--
-- Each duplicate is merged into the kept exercise in this order:
--   1. Every reference to it moves to the kept exercise.
--   2. The duplicate is deleted.
-- The foreign keys to exercises have no ON DELETE action. A reference left behind
-- therefore makes the delete fail, and nothing in this file is applied.
--
-- Moving a reference can put the same exercise in one place twice:
--   - workout_planned_exercises: the duplicate's row is dropped. The table has
--     unique (workout_id, exercise_id).
--   - routine_exercises: the duplicate's row is dropped. Nothing enforces it, but a
--     routine shouldn't list one exercise twice.
--   - workout_sets: every set is kept. Where two set 1s would collide, the sets are
--     numbered again by time.
-- Pending Ronnie proposals for a duplicate are pointed at the kept exercise.
--
-- It is one DO block, so it is a single statement and applies all or nothing even
-- where the SQL Editor runs statements one at a time. A first version used
-- begin/commit with a temporary table, and failed there with: relation
-- "exercise_merge" does not exist.
--
-- It is safe to run twice. It fails rather than guess: the checks at the end
-- expect the library as exported on 2026-10-08 (141 built-in exercises).

do $$
declare
    v_builtin int;
begin

    -- ---------------------------------------------------------------------------
    -- 1. Merge 12 duplicates: (duplicate, kept)

    create temporary table exercise_merge (dup uuid primary key, keep uuid not null) on commit drop;
    insert into exercise_merge (dup, keep) values
        -- Barbell Bicep Curl -> Barbell Curl
        ('bbe9d885-cb60-4bd4-bff7-49d41fd590d0', '2374ccea-4620-4458-a835-e41c34b8dfa8'),
        -- Dumbbell Bicep Curl -> Dumbbell Curl
        ('ab0bdc6d-2e43-4fd3-bf2f-6bae2ffd5b09', 'b23b42f3-4173-43c7-833b-cf3273f64c48'),
        -- Cable Bicep Curl -> Cable Curl
        ('16c5e6b8-58c9-45d3-bbc8-95cce31eb6cd', '63ff7227-a29f-4d87-9e50-150affa36dd5'),
        -- Machine Bicep Curl -> Machine Curl
        ('ab86c210-3a8e-4f5b-9055-330f9449d402', '770899ef-8797-4c90-8560-912446fa755d'),
        -- Cable Tricep Pushdown -> Triceps Pushdown
        ('8e49f44d-9002-4174-9d96-21c9cab65f3c', 'c2da64d0-2bcb-4260-990f-8ec525601280'),
        -- Cable Overhead Tricep Extension -> Cable Overhead Extension
        ('4a6630af-1774-47f4-8afd-b0b89b696080', '45731af9-c59d-4cb6-88f2-b908cf2796cd'),
        -- Tricep Machine -> Machine Triceps Extension
        ('ba74c51c-d807-49c1-a90a-4c99c79eef55', 'ac7c512a-3634-4902-864c-74f237c96f12'),
        -- Cable Crunch Kneeling -> Cable Crunch
        ('1f938d6d-cc82-4799-9a6b-9a65bc40bca6', '55b06993-12a0-444c-ba03-97e53498ec5b'),
        -- Cable Pull Through Glute -> Cable Pull Through
        ('fac91178-2a41-4ee1-9d0e-ecc996437480', '0e52cb87-81ed-4d9a-9bfe-a1e8cf5f022b'),
        -- Barbell Good Morning -> Good Morning
        ('d03bd1cb-0d8d-46d3-97c2-e53b000c0d2d', '540e71e6-f88c-4da1-a63d-7c691af30c39'),
        -- Cable Chest Fly -> Cable Fly
        ('66f39b51-6334-4c5a-9b51-b78e128dd45c', '97f47ef6-d55b-4c1c-929b-6b0f4cdc5e56'),
        -- Cable Crossover -> Cable Fly
        ('8da49bca-013c-4d24-8cb8-dbfa737aaf88', '97f47ef6-d55b-4c1c-929b-6b0f4cdc5e56');

    -- Rows that would become the same exercise in one workout or routine: keep the
    -- row already on the kept exercise, otherwise the first one
    delete from workout_planned_exercises
    where id in (
        select id from (
            select w.id, row_number() over (
                partition by w.workout_id, coalesce(m.keep, w.exercise_id)
                order by m.dup is not null, w.id) as n
            from workout_planned_exercises w
            left join exercise_merge m on m.dup = w.exercise_id
            where w.exercise_id in (select dup from exercise_merge union select keep from exercise_merge)
        ) ranked
        where n > 1
    );
    update workout_planned_exercises w set exercise_id = m.keep
    from exercise_merge m where w.exercise_id = m.dup;

    delete from routine_exercises
    where id in (
        select id from (
            select r.id, row_number() over (
                partition by r.routine_id, coalesce(m.keep, r.exercise_id)
                order by m.dup is not null, r.order_index) as n
            from routine_exercises r
            left join exercise_merge m on m.dup = r.exercise_id
            where r.exercise_id in (select dup from exercise_merge union select keep from exercise_merge)
        ) ranked
        where n > 1
    );
    update routine_exercises r set exercise_id = m.keep
    from exercise_merge m where r.exercise_id = m.dup;

    update workout_sets s set exercise_id = m.keep
    from exercise_merge m where s.exercise_id = m.dup;

    with collided as (
        select workout_id, exercise_id
        from workout_sets
        where exercise_id in (select keep from exercise_merge)
        group by workout_id, exercise_id
        having count(*) > count(distinct set_number)
    ), numbered as (
        select s.id, row_number() over (
            partition by s.workout_id, s.exercise_id
            order by s.created_at, s.set_number, s.id) as n
        from workout_sets s
        join collided c on c.workout_id = s.workout_id and c.exercise_id = s.exercise_id
    )
    update workout_sets s set set_number = numbered.n
    from numbered where s.id = numbered.id;

    update ronnie_pending_actions p
    set action = jsonb_set(p.action, '{exerciseId}', to_jsonb(m.keep::text))
    from exercise_merge m
    where p.status = 'pending' and p.action ->> 'exerciseId' = m.dup::text;

    delete from exercises where id in (select dup from exercise_merge);

    -- ---------------------------------------------------------------------------
    -- 2. Names and muscle groups (31 exercises): (id, name, name_zh_tw, muscle_group)

    update exercises e
    set name = v.name, name_zh_tw = v.name_zh_tw, muscle_group = v.muscle_group
    from (values
        ('07698d2d-2e8f-4613-b703-ec0a878ca7c9', 'Close-Grip Bench Press', '窄握臥推', 'triceps'),
        ('35bd73ee-0bdb-4a22-8cdd-75bf9c56fb15', 'Cable Glute Kickback', '繩索臀部後踢', 'glutes'),
        ('36383382-f718-48da-a04b-50655b16b904', 'Dumbbell Pullover', '啞鈴仰臥拉舉', 'chest'),
        ('97f47ef6-d55b-4c1c-929b-6b0f4cdc5e56', 'Cable Fly', '繩索夾胸', 'chest'),
        ('520b3d4d-868a-4999-970c-a6dd4f1cfb08', 'Frog Pump', '青蛙臀橋', 'glutes'),
        ('4fdfcaf0-feef-4ed7-b91e-aa455795ae5b', 'Hip Thrust Machine', '臀推機', 'glutes'),
        ('4b7d05f8-324f-45d1-9ef3-ab6e18b8eff4', 'Plank', '棒式', 'core'),
        ('5c3a0eb4-1f1a-4c0b-b18f-0a14bfa7b461', 'Bicycle Crunch', '腳踏車捲腹', 'core'),
        ('38d4887f-1427-45e6-ad98-d0cacfe7786a', 'Ab Wheel Rollout', '健腹輪', 'core'),
        ('c7aa400c-e228-4916-bcc5-9704a506e946', 'Step Up', '登階', 'legs'),
        ('ca7667a9-1455-478a-afa8-c8620a18a122', 'Hack Squat', '哈克深蹲', 'legs'),
        ('7b49723c-bc70-4abc-b901-8030f90d72f6', 'Glute Ham Raise', '臀腿抬升（GHR）', 'glutes'),
        ('0e52cb87-81ed-4d9a-9bfe-a1e8cf5f022b', 'Cable Pull Through', '繩索 Pull Through', 'glutes'),
        ('1b0d3a81-bf2c-4b3f-a16b-08c2eb248fb8', 'Seated Cable Row', '坐姿繩索划船', 'back'),
        ('dc1a6fe0-cded-4b62-80e6-ddd038d0f2bb', 'Wide Grip Cable Row', '寬握繩索划船', 'back'),
        ('8049d0df-aaec-4c33-b9b1-b4bf1000bfc4', 'T-Bar Row', 'T槓划船', 'back'),
        ('7dfba9c8-93c0-4b8d-a7d3-8d50a4fa6b94', 'Leg Raise', '仰臥抬腿', 'core'),
        ('7c9889b7-a2c3-436e-b023-d782a0632b6a', 'Pallof Press', '帕洛夫推舉', 'core'),
        ('6bc596d0-db60-4b34-98e4-5167ed81d033', 'High Cable Fly', '高位繩索夾胸', 'chest'),
        ('37711609-a73a-4a88-bd0f-8741535b61c6', 'Low Cable Fly', '低位繩索夾胸', 'chest'),
        ('45731af9-c59d-4cb6-88f2-b908cf2796cd', 'Cable Overhead Triceps Extension', '繩索過頭三頭伸展', 'triceps'),
        ('c2da64d0-2bcb-4260-990f-8ec525601280', 'Triceps Pushdown', '三頭下壓', 'triceps'),
        ('4dbfd97e-2f21-4b59-b316-90cc1d9d900a', 'Rope Pushdown', '麻繩三頭下壓', 'triceps'),
        ('a386b344-3408-469f-b0e3-3ad8b6761365', 'Single Arm Cable Pushdown', '單臂三頭下壓', 'triceps'),
        ('ac5ec815-d1f9-4a7d-91c7-69bcbd2ef16c', 'Cable Lateral Raise', '繩索側平舉', 'shoulders'),
        ('7203ed9a-a95b-4d51-ae97-c888dcab33dc', 'Machine Row', '器械划船', 'back'),
        ('770899ef-8797-4c90-8560-912446fa755d', 'Machine Curl', '器械彎舉', 'biceps'),
        ('1314c887-9309-4104-8195-b30dd29e2ed1', 'Machine Lateral Raise', '器械側平舉', 'shoulders'),
        ('ac7c512a-3634-4902-864c-74f237c96f12', 'Machine Triceps Extension', '器械三頭伸展', 'triceps'),
        ('930f0373-27a4-4e41-95aa-45a5f65837f0', 'Hip Thrust', '臀推', 'glutes'),
        ('540e71e6-f88c-4da1-a63d-7c691af30c39', 'Good Morning', '早安式', 'legs')
    ) as v (id, name, name_zh_tw, muscle_group)
    where e.id = v.id::uuid;

    -- ---------------------------------------------------------------------------
    -- 3. Equipment in lower case (barbell, not Barbell)

    update exercises set equipment = lower(equipment)
    where not coalesce(is_custom, false) and equipment <> lower(equipment);

    -- ---------------------------------------------------------------------------
    -- 4. 19 new exercises: (id, name, name_zh_tw, muscle_group, equipment)

    insert into exercises (id, name, name_zh_tw, muscle_group, equipment, is_custom)
    select v.id::uuid, v.name, v.name_zh_tw, v.muscle_group, v.equipment, false
    from (values
        ('316906f4-ff41-55f0-a009-e8a172caf5b0', 'Burpee', '波比跳', 'cardio', 'bodyweight'),
        ('64e8912e-7cdb-5abe-b6b5-4e755f5cf0c1', 'Jump Rope', '跳繩', 'cardio', 'other'),
        ('275c314f-e01a-56d0-b139-4e1a7670a9ea', 'Stair Climber', '爬梯機', 'cardio', 'machine'),
        ('27f56534-d241-55e2-9c47-b5e090946515', 'Machine Chest Press', '器械推胸', 'chest', 'machine'),
        ('575ee01c-ace7-5e38-a39d-3e437f8decb0', 'Decline Barbell Bench Press', '下斜槓鈴臥推', 'chest', 'barbell'),
        ('01cab5f1-f62c-5998-93b1-8fe221b929f8', 'Straight-Arm Pulldown', '直臂下拉', 'back', 'cable'),
        ('b1f735c6-9359-53d8-92ba-492d7b3b74c1', 'Assisted Pull-up', '輔助引體向上', 'back', 'machine'),
        ('49d93e9a-1046-55ef-b402-ad802775815c', 'Inverted Row', '反向划船', 'back', 'bodyweight'),
        ('9ffc05c4-965a-5769-b0a2-3eb1c2799ec5', 'Back Extension', '背部伸展', 'back', 'bodyweight'),
        ('cec4fc59-2312-52cb-a4e2-68519ece446e', 'Barbell Shrug', '槓鈴聳肩', 'back', 'barbell'),
        ('d1e0a931-56f6-555c-904e-01a59cc96f3c', 'Goblet Squat', '高腳杯深蹲', 'legs', 'dumbbell'),
        ('298f7000-9b0a-5acc-b784-0b146831be61', 'Bodyweight Squat', '徒手深蹲', 'legs', 'bodyweight'),
        ('74ec2d18-b432-53d9-b99a-c1fb31142443', 'Seated Calf Raise', '坐姿提踵', 'legs', 'machine'),
        ('1062bc05-8db6-533a-ab8e-2a570f89b4e4', 'Trap Bar Deadlift', '六角槓硬舉', 'legs', 'barbell'),
        ('51231e88-fb37-5348-ae6b-5c988e2ca2af', 'Kettlebell Swing', '壺鈴擺盪', 'glutes', 'kettlebell'),
        ('ca181139-5ad8-5d8f-8d0c-42e99f18ac3b', 'Crunch', '捲腹', 'core', 'bodyweight'),
        ('d0fc0fac-f489-567a-a508-125d5e78c14f', 'Side Plank', '側棒式', 'core', 'bodyweight'),
        ('bb195bba-3b13-5e43-8552-360dcc34edc9', 'Mountain Climber', '登山者', 'core', 'bodyweight'),
        ('f3810e46-3d07-5dea-8b6b-846e22cd7a31', 'Diamond Push-up', '鑽石伏地挺身', 'triceps', 'bodyweight')
    ) as v (id, name, name_zh_tw, muscle_group, equipment)
    where not exists (
        select 1 from exercises e
        where e.id = v.id::uuid or (e.name = v.name and not coalesce(e.is_custom, false))
    );

    -- ---------------------------------------------------------------------------
    -- 5. Checks: any failure undoes everything above

    select count(*) into v_builtin from exercises where not coalesce(is_custom, false);
    if v_builtin <> 148 then
        raise exception 'Expected 148 built-in exercises, found % - the library changed since it was exported', v_builtin;
    end if;
    if exists (select 1 from exercises where not coalesce(is_custom, false) group by name having count(*) > 1)
       or exists (select 1 from exercises where not coalesce(is_custom, false) group by name_zh_tw having count(*) > 1) then
        raise exception 'Two built-in exercises share an English or a Chinese name';
    end if;
end $$;
