-- Mochi Farm: initial schema.
-- Run once in the Supabase dashboard → SQL Editor (or `supabase db push` if you use the CLI).
--
-- Every signed-in player (guests included; they use the `authenticated` role) owns:
--   profiles        name, Mochi's look and room (friends can see these), invite code
--   game_state      the whole saved game (coins, items, streaks…) as JSON, for sync and restore
--   focus_sessions  one row per focus session, timed by the server so leaderboard minutes are real
--   friendships     who is friends with whom (always stored in both directions)

-- ============================================================ tables

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  pet_name     text not null default 'Mochi' check (char_length(pet_name) <= 24),
  look         jsonb not null default '{}'::jsonb,   -- species, color, hat, glasses, neck, outfit
  equip        jsonb not null default '{}'::jsonb,   -- furniture in use, per category
  cozy_score   int not null default 0,
  invite_code  text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.game_state (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  state             jsonb not null default '{}'::jsonb,
  -- when the phone made the change; only newer changes overwrite older ones
  client_updated_at timestamptz not null default 'epoch',
  updated_at        timestamptz not null default now()
);

create table public.focus_sessions (
  id          uuid primary key,                      -- created on the phone, so retries are safe
  user_id     uuid not null references auth.users (id) on delete cascade,
  minutes     int not null check (minutes in (15, 25, 45, 60)),
  local_day   date not null,                         -- the player's own calendar day
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  completed   boolean not null default false
);
create index focus_sessions_user_day on public.focus_sessions (user_id, local_day);

create table public.friendships (
  user_id    uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend on public.friendships (friend_id);

-- ============================================================ new players

-- every new account (guest or email) gets a profile and an empty saved game
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.game_state (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ row level security

alter table public.profiles       enable row level security;
alter table public.game_state     enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.friendships    enable row level security;

-- used inside policies; security definer so it doesn't recurse through friendships' own RLS
create function public.is_friend(p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships where user_id = auth.uid() and friend_id = p_other
  );
$$;

create policy "see own and friends' profiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_friend(id));

create policy "edit own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- the invite code and ids are not editable from the app
revoke update on public.profiles from authenticated, anon;
grant update (display_name, pet_name, look, equip, cozy_score, updated_at) on public.profiles to authenticated;

create policy "read own saved game" on public.game_state
  for select to authenticated using (user_id = (select auth.uid()));

create policy "update own saved game" on public.game_state
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "see own and friends' sessions" on public.focus_sessions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_friend(user_id));

create policy "see own friendships" on public.friendships
  for select to authenticated using (user_id = (select auth.uid()));

-- sessions and friendships are only written through the functions below
revoke insert, update, delete on public.focus_sessions from authenticated, anon;
revoke insert, update, delete on public.friendships    from authenticated, anon;
revoke insert, delete         on public.profiles       from authenticated, anon;
revoke insert, delete         on public.game_state     from authenticated, anon;

-- ============================================================ saving the game

-- last write wins, judged by when the phone made the change; returns null if the server already has something newer
create function public.save_game_state(p_state jsonb, p_client_updated_at timestamptz)
returns timestamptz language sql security invoker set search_path = '' as $$
  update public.game_state
     set state = p_state, client_updated_at = p_client_updated_at, updated_at = now()
   where user_id = auth.uid() and client_updated_at < p_client_updated_at
  returning client_updated_at;
$$;

-- ============================================================ server-timed focus sessions

-- starting a session ends any other open one, so sessions can't be stacked across devices
create function public.start_session(p_id uuid, p_minutes int, p_local_day date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_local_day not between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date + 1 then
    raise exception 'local_day is not today';
  end if;
  update public.focus_sessions set finished_at = now()
   where user_id = auth.uid() and finished_at is null and id <> p_id;
  insert into public.focus_sessions (id, user_id, minutes, local_day)
  values (p_id, auth.uid(), p_minutes, p_local_day)
  on conflict (id) do nothing;
end $$;

-- a session only counts if the full time has really passed on the server's clock
create function public.finish_session(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  update public.focus_sessions
     set completed = true, finished_at = now()
   where id = p_id and user_id = auth.uid() and finished_at is null
     and now() >= started_at + make_interval(mins => minutes) - interval '30 seconds'
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- leaving the app or stopping early
create function public.abandon_session(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.focus_sessions set finished_at = now()
   where id = p_id and user_id = auth.uid() and finished_at is null;
$$;

-- ============================================================ friends

-- add a friend by their invite code; friendship is mutual
create function public.add_friend(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into other from public.profiles where invite_code = upper(trim(p_code));
  if other is null then raise exception 'No one has that invite code'; end if;
  if other = auth.uid() then raise exception 'That is your own invite code'; end if;
  insert into public.friendships (user_id, friend_id) values (auth.uid(), other), (other, auth.uid())
  on conflict do nothing;
  return other;
end $$;

create function public.remove_friend(p_friend uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
   where (user_id = auth.uid() and friend_id = p_friend)
      or (user_id = p_friend and friend_id = auth.uid());
$$;

-- you and your friends, with completed (server-verified) focus minutes per day since p_from
create function public.friend_board(p_from date)
returns table (
  user_id uuid, is_me boolean, display_name text, pet_name text,
  look jsonb, equip jsonb, cozy_score int, daily jsonb
) language sql stable security invoker set search_path = '' as $$
  with people as (
    select auth.uid() as id
    union
    select f.friend_id from public.friendships f where f.user_id = auth.uid()
  )
  select p.id, p.id = auth.uid(), p.display_name, p.pet_name, p.look, p.equip, p.cozy_score,
         coalesce((
           select jsonb_object_agg(d.local_day, d.mins)
             from (select s.local_day, sum(s.minutes) as mins
                     from public.focus_sessions s
                    where s.user_id = p.id and s.completed and s.local_day >= p_from
                    group by s.local_day) d
         ), '{}'::jsonb)
    from people x join public.profiles p on p.id = x.id;
$$;

-- only signed-in players (guests included) may call these
revoke execute on function
  public.save_game_state(jsonb, timestamptz), public.start_session(uuid, int, date),
  public.finish_session(uuid), public.abandon_session(uuid), public.add_friend(text),
  public.remove_friend(uuid), public.friend_board(date), public.is_friend(uuid)
  from public, anon;
grant execute on function
  public.save_game_state(jsonb, timestamptz), public.start_session(uuid, int, date),
  public.finish_session(uuid), public.abandon_session(uuid), public.add_friend(text),
  public.remove_friend(uuid), public.friend_board(date), public.is_friend(uuid)
  to authenticated;
