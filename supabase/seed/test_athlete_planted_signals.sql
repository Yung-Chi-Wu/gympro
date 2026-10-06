-- Synthetic test athlete with planted training signals, for exercising the
-- AI report pipeline end to end without touching a real account.
--
-- Prerequisite: create the auth user first in Supabase Dashboard >
-- Authentication > Users > Add user, with email test-athlete@example.com
-- and "Auto Confirm User" checked. Then run this file in the SQL Editor.
-- Re-running it wipes and re-seeds only this test user's data. The user is
-- looked up by that email alone; example.com is reserved for testing, so no
-- real account can match it.
--
-- Three Mon–Sun weeks (2026-09-14, 09-21, 09-28), the same 4 sessions each week.
-- Planted signals a correct report for the 2026-09-28 week should pick up:
--   1. Bench press progresses every week (60 -> 62.5 -> 65 kg x 8)  -> chest improving
--   2. Squat regresses in the last week (80 -> 80 -> 75 kg x 5)     -> legs going backwards
--   3. Shoulder press, row and curl never change                    -> stalling lifts
--   4. Push volume (chest + shoulders + triceps, 17 sets) dwarfs pull
--      (back + biceps, 6 sets), and legs get only 4 sets            -> push/pull and leg imbalance

do $$
declare
  test_uid uuid;
  ex_bench uuid; ex_ohp uuid; ex_tri uuid; ex_row uuid; ex_curl uuid; ex_squat uuid;
  w int;
  d int;
  wid uuid;
begin
  select id into test_uid from auth.users where email = 'test-athlete@example.com';
  if test_uid is null then
    raise exception 'Create the auth user test-athlete@example.com first (Authentication > Users > Add user)';
  end if;

  -- Prefer the classic lift for each slot, fall back to any built-in exercise in that muscle group
  ex_bench := coalesce(
    (select id from public.exercises where muscle_group = 'chest' and not coalesce(is_custom, false) and name ilike '%bench press%' order by name limit 1),
    (select id from public.exercises where muscle_group = 'chest' and not coalesce(is_custom, false) order by name limit 1));
  ex_ohp := coalesce(
    (select id from public.exercises where muscle_group = 'shoulders' and not coalesce(is_custom, false) and name ilike '%press%' order by name limit 1),
    (select id from public.exercises where muscle_group = 'shoulders' and not coalesce(is_custom, false) order by name limit 1));
  ex_tri := coalesce(
    (select id from public.exercises where muscle_group = 'triceps' and not coalesce(is_custom, false) and name ilike '%pushdown%' order by name limit 1),
    (select id from public.exercises where muscle_group = 'triceps' and not coalesce(is_custom, false) order by name limit 1));
  ex_row := coalesce(
    (select id from public.exercises where muscle_group = 'back' and not coalesce(is_custom, false) and name ilike '%row%' order by name limit 1),
    (select id from public.exercises where muscle_group = 'back' and not coalesce(is_custom, false) order by name limit 1));
  ex_curl := coalesce(
    (select id from public.exercises where muscle_group = 'biceps' and not coalesce(is_custom, false) and name ilike '%curl%' order by name limit 1),
    (select id from public.exercises where muscle_group = 'biceps' and not coalesce(is_custom, false) order by name limit 1));
  ex_squat := coalesce(
    (select id from public.exercises where muscle_group = 'legs' and not coalesce(is_custom, false) and name ilike '%squat%' order by name limit 1),
    (select id from public.exercises where muscle_group = 'legs' and not coalesce(is_custom, false) order by name limit 1));

  if ex_bench is null or ex_ohp is null or ex_tri is null or ex_row is null or ex_curl is null or ex_squat is null then
    raise exception 'No built-in exercise found for one of: chest, shoulders, triceps, back, biceps, legs';
  end if;

  -- Start from a clean slate for the test user only
  delete from public.workout_sets where user_id = test_uid;
  delete from public.workout_planned_exercises where user_id = test_uid;
  delete from public.workouts where user_id = test_uid;
  delete from public.body_metrics where user_id = test_uid;
  delete from public.period_reports where user_id = test_uid;

  -- Update-then-insert, since a signup trigger may already have created the profile row
  update public.user_profiles set
    display_name = 'Test Athlete',
    training_goal = '增肌，三個月內臥推做到 80 公斤',
    height_cm = 175,
    date_of_birth = '1998-05-01',
    sex = 'male',
    language = 'zh-TW',
    timezone = 'America/New_York',
    weight_unit = 'kg',
    onboarding_completed = true
  where user_id = test_uid;

  if not found then
    insert into public.user_profiles
      (user_id, display_name, training_goal, height_cm, date_of_birth, sex, language, timezone, weight_unit, onboarding_completed)
    values
      (test_uid, 'Test Athlete', '增肌，三個月內臥推做到 80 公斤', 175, '1998-05-01', 'male', 'zh-TW', 'America/New_York', 'kg', true);
  end if;

  insert into public.body_metrics (user_id, weight_kg, recorded_at) values
    (test_uid, 72.0, '2026-09-14 08:00:00-04'),
    (test_uid, 72.3, '2026-09-21 08:00:00-04'),
    (test_uid, 72.6, '2026-09-28 08:00:00-04');

  -- Weekly program: day offset from Monday, exercise, sets, reps, load in week 1 / 2 / 3
  drop table if exists seed_plan;
  create temp table seed_plan (day_offset int, exercise uuid, sets int, reps int, w1 numeric, w2 numeric, w3 numeric);
  insert into seed_plan values
    (0, ex_bench, 4,  8, 60, 62.5, 65),   -- Mon push
    (0, ex_ohp,   3,  8, 35, 35,   35),
    (0, ex_tri,   3, 12, 25, 27.5, 30),
    (2, ex_row,   3, 10, 50, 50,   50),   -- Wed pull
    (2, ex_curl,  3, 12, 12, 12,   12),
    (4, ex_bench, 4,  8, 60, 62.5, 65),   -- Fri push
    (4, ex_ohp,   3,  8, 35, 35,   35),
    (5, ex_squat, 4,  5, 80, 80,   75);   -- Sat legs

  for w in 0..2 loop
    for d in select distinct day_offset from seed_plan order by 1 loop
      -- 6pm New York time, so the UTC date matches the local training day
      insert into public.workouts (user_id, performed_at, title)
      values (test_uid, ((date '2026-09-14' + w * 7 + d)::timestamp + time '18:00') at time zone 'America/New_York', 'Seed workout')
      returning id into wid;

      insert into public.workout_planned_exercises (workout_id, exercise_id, user_id)
      select distinct wid, p.exercise, test_uid from seed_plan p where p.day_offset = d;

      insert into public.workout_sets (workout_id, exercise_id, user_id, set_number, reps, weight_kg)
      select wid, p.exercise, test_uid, s, p.reps, case w when 0 then p.w1 when 1 then p.w2 else p.w3 end
      from seed_plan p, generate_series(1, p.sets) as s
      where p.day_offset = d;
    end loop;
  end loop;

  drop table seed_plan;

  raise notice 'Seeded test athlete %', test_uid;
end;
$$;

-- Check: expect 12 workouts and 81 sets (27 per week)
select
  (select id from auth.users where email = 'test-athlete@example.com') as test_user_id,
  (select count(*) from public.workouts w join auth.users u on u.id = w.user_id where u.email = 'test-athlete@example.com') as workouts,
  (select count(*) from public.workout_sets s join auth.users u on u.id = s.user_id where u.email = 'test-athlete@example.com') as sets;
