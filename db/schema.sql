-- AssignDash database schema for Supabase (Postgres 15+).
-- Run it in the Supabase SQL editor of a new project. It is safe to run again.
--
-- Authorization model
-- -------------------
-- The browser never talks to Supabase directly. Only the Express server does, using the
-- service-role key, and it checks that the signed-in user owns every row it touches.
-- Row-level security is therefore enabled with NO policies, and table and function
-- privileges are revoked from the anon and authenticated roles: anyone holding the public
-- anon key gets nothing from the Data API. (The service role bypasses RLS by design.)

-- Tables --------------------------------------------------------------------------------

create table if not exists public.semesters (
  id          bigint generated always as identity primary key,
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  constraint semester_dates_in_order check (end_date >= start_date)
);

create table if not exists public.classes (
  id           bigint generated always as identity primary key,
  semester_id  bigint not null references public.semesters (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 200),
  short_name   text not null check (char_length(short_name) between 1 and 40),
  position     integer not null check (position >= 0), -- display order; also picks the colour
  unique (semester_id, position)
);

create table if not exists public.assignments (
  id         bigint generated always as identity primary key,
  class_id   bigint not null references public.classes (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 300),
  date       date not null,
  end_date   date,
  due_time   time,
  type       text not null default 'due'
             check (type in ('exam', 'due', 'quiz', 'discussion', 'conference', 'workshop', 'prep')),
  completed  boolean not null default false,
  constraint assignment_dates_in_order check (end_date is null or end_date > date)
);

create index if not exists classes_semester_id_idx on public.classes (semester_id);
create index if not exists assignments_class_id_idx on public.assignments (class_id);

-- Extraction counters for the per-user and global daily quotas (days are UTC).
create table if not exists public.extraction_usage (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  count    integer not null default 0,
  primary key (user_id, day)
);

create table if not exists public.extraction_usage_total (
  day    date primary key,
  count  integer not null default 0
);

-- Functions -----------------------------------------------------------------------------
-- Each function call is one transaction: if any statement fails, nothing is written.

-- Inserts a class's items, skipping any with the same date and title (case-insensitive)
-- as an existing item in that class or earlier in the same batch.
create or replace function public.insert_assignments(p_class_id bigint, p_items jsonb)
returns integer
language sql
set search_path = ''
as $$
  with incoming as (
    select distinct on ((item ->> 'date')::date, lower(item ->> 'title'))
           item ->> 'title' as title,
           (item ->> 'date')::date as date,
           (item ->> 'end_date')::date as end_date,
           (item ->> 'due_time')::time as due_time,
           coalesce(item ->> 'type', 'due') as type
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  ),
  inserted as (
    insert into public.assignments (class_id, title, date, end_date, due_time, type)
    select p_class_id, i.title, i.date, i.end_date, i.due_time, i.type
      from incoming i
     where not exists (
       select 1 from public.assignments a
        where a.class_id = p_class_id and a.date = i.date and lower(a.title) = lower(i.title)
     )
    returning 1
  )
  select count(*)::integer from inserted;
$$;

-- Adds classes to a semester. A class whose name matches an existing one (ignoring case
-- and surrounding spaces) receives the new items; other classes are appended in order.
create or replace function public.merge_classes(p_semester_id bigint, p_classes jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_class jsonb;
  v_class_id bigint;
  v_next_position integer;
begin
  select coalesce(max(position) + 1, 0) into v_next_position
    from public.classes where semester_id = p_semester_id;

  for v_class in select value from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) loop
    select id into v_class_id
      from public.classes
     where semester_id = p_semester_id
       and lower(btrim(name)) = lower(btrim(v_class ->> 'name'))
     order by position
     limit 1;

    if v_class_id is null then
      insert into public.classes (semester_id, name, short_name, position)
      values (p_semester_id, btrim(v_class ->> 'name'), v_class ->> 'short_name', v_next_position)
      returning id into v_class_id;
      v_next_position := v_next_position + 1;
    end if;

    perform public.insert_assignments(v_class_id, v_class -> 'assignments');
  end loop;
end;
$$;

-- Replaces the user's schedule. The old semester is deleted in the same transaction that
-- writes the new one, so a failed save leaves the existing dashboard untouched.
create or replace function public.save_schedule(p_user_id uuid, p_schedule jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_semester_id bigint;
begin
  -- Serialise concurrent saves by the same user (e.g. a double-clicked Save button).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  delete from public.semesters where user_id = p_user_id;

  insert into public.semesters (user_id, name, start_date, end_date)
  values (p_user_id,
          p_schedule ->> 'semester_name',
          (p_schedule ->> 'semester_start')::date,
          (p_schedule ->> 'semester_end')::date)
  returning id into v_semester_id;

  -- The same course can arrive twice (say, a PDF syllabus and its schedule spreadsheet);
  -- merging by name keeps it as one class.
  perform public.merge_classes(v_semester_id, p_schedule -> 'classes');
  return v_semester_id;
end;
$$;

-- Adds another syllabus to the user's semester: classes are merged by name and the term
-- dates only ever widen. Returns null when the user has no semester yet.
create or replace function public.merge_schedule(p_user_id uuid, p_schedule jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_semester_id bigint;
begin
  select id into v_semester_id from public.semesters where user_id = p_user_id for update;
  if not found then
    return null;
  end if;

  perform public.merge_classes(v_semester_id, p_schedule -> 'classes');

  update public.semesters
     set start_date = least(start_date, coalesce((p_schedule ->> 'semester_start')::date, start_date)),
         end_date = greatest(end_date, coalesce((p_schedule ->> 'semester_end')::date, end_date))
   where id = v_semester_id;

  return v_semester_id;
end;
$$;

-- Counts one extraction against the user's and the global daily limits.
-- Returns 'ok', 'user_limit' or 'global_limit'; nothing is counted when a limit is hit.
create or replace function public.consume_extraction_quota(p_user_id uuid, p_user_limit integer, p_global_limit integer)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  insert into public.extraction_usage as u (user_id, day, count)
  values (p_user_id, v_day, 1)
  on conflict (user_id, day) do update set count = u.count + 1 where u.count < p_user_limit
  returning u.count into v_count;
  if v_count is null then
    return 'user_limit';
  end if;

  insert into public.extraction_usage_total as t (day, count)
  values (v_day, 1)
  on conflict (day) do update set count = t.count + 1 where t.count < p_global_limit
  returning t.count into v_count;
  if v_count is null then
    update public.extraction_usage set count = count - 1 where user_id = p_user_id and day = v_day;
    return 'global_limit';
  end if;

  return 'ok';
end;
$$;

-- Access control ------------------------------------------------------------------------

alter table public.semesters enable row level security;
alter table public.classes enable row level security;
alter table public.assignments enable row level security;
alter table public.extraction_usage enable row level security;
alter table public.extraction_usage_total enable row level security;

-- Deliberately no policies: see the note at the top of this file.

revoke all on table public.semesters, public.classes, public.assignments,
                    public.extraction_usage, public.extraction_usage_total
  from anon, authenticated;
grant select, insert, update, delete on table public.semesters, public.classes, public.assignments,
                                             public.extraction_usage, public.extraction_usage_total
  to service_role;

revoke execute on function public.insert_assignments(bigint, jsonb),
                           public.merge_classes(bigint, jsonb),
                           public.save_schedule(uuid, jsonb),
                           public.merge_schedule(uuid, jsonb),
                           public.consume_extraction_quota(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.insert_assignments(bigint, jsonb),
                          public.merge_classes(bigint, jsonb),
                          public.save_schedule(uuid, jsonb),
                          public.merge_schedule(uuid, jsonb),
                          public.consume_extraction_quota(uuid, integer, integer)
  to service_role;
