-- 로비(프로필·방)와 온라인 대전(행동 제출) 스키마
-- 원칙: 클라이언트는 테이블을 직접 바꾸지 않고 아래 함수(RPC)로만 상태를 바꾼다. 조회는 RLS 로 제한.

create extension if not exists pgcrypto with schema extensions;

-- ───────────── 프로필 ─────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 12),
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "프로필 조회" on public.profiles for select to authenticated using (true);

-- 프로필 만들기·닉네임 변경 (전적은 finish_match 만 바꿈)
create or replace function public.upsert_profile(p_nickname text)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare r public.profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into profiles (id, nickname) values (auth.uid(), p_nickname)
  on conflict (id) do update set nickname = excluded.nickname, updated_at = now()
  returning * into r;
  return r;
end $$;

-- ───────────── 방 ─────────────

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 20),
  host_id uuid not null references auth.users (id) on delete cascade,
  host_name text not null,
  guest_id uuid references auth.users (id) on delete set null,
  guest_name text,
  guest_ready boolean not null default false,
  has_password boolean not null default false,
  turn_seconds int not null check (turn_seconds in (15, 30, 60)),
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'closed')),
  match_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 비밀번호는 아무도 직접 못 읽는 별도 테이블 (해시)
create table public.room_secrets (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  password_hash text not null
);

alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;
create policy "열린 방 조회" on public.rooms for select to authenticated using (status <> 'closed');

create or replace function public.my_nickname()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select nickname from profiles where id = auth.uid()), '플레이어') $$;

create or replace function public.create_room(p_title text, p_password text, p_turn_seconds int)
returns public.rooms
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- 한 사람당 열린 방 하나
  update rooms set status = 'closed', updated_at = now() where host_id = auth.uid() and status <> 'closed';
  insert into rooms (title, host_id, host_name, has_password, turn_seconds)
  values (coalesce(nullif(trim(p_title), ''), my_nickname() || '의 방'), auth.uid(), my_nickname(),
          coalesce(trim(p_password), '') <> '', p_turn_seconds)
  returning * into r;
  if coalesce(trim(p_password), '') <> '' then
    insert into room_secrets (room_id, password_hash) values (r.id, crypt(trim(p_password), gen_salt('bf')));
  end if;
  return r;
end $$;

create or replace function public.join_room(p_room_id uuid, p_password text)
returns public.rooms
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.rooms; h text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into r from rooms where id = p_room_id for update;
  if not found or r.status = 'closed' then raise exception '방이 없습니다'; end if;
  if r.host_id = auth.uid() then return r; end if;
  if r.guest_id = auth.uid() then return r; end if;
  if r.status <> 'waiting' or r.guest_id is not null then raise exception '방이 가득 찼습니다'; end if;
  if r.has_password then
    select password_hash into h from room_secrets where room_id = r.id;
    if h is null or crypt(coalesce(p_password, ''), h) <> h then raise exception '비밀번호가 틀렸습니다'; end if;
  end if;
  update rooms set guest_id = auth.uid(), guest_name = my_nickname(), guest_ready = false, updated_at = now()
  where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update rooms set status = 'closed', updated_at = now() where id = p_room_id and host_id = auth.uid();
  update rooms set guest_id = null, guest_name = null, guest_ready = false, updated_at = now()
  where id = p_room_id and guest_id = auth.uid();
end $$;

create or replace function public.set_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update rooms set guest_ready = p_ready, updated_at = now() where id = p_room_id and guest_id = auth.uid();
end $$;

-- ───────────── 대전 ─────────────

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  host_id uuid not null references auth.users (id),
  guest_id uuid not null references auth.users (id),
  turn_seconds int not null,
  host_deck jsonb not null,
  guest_deck jsonb,
  status text not null default 'playing' check (status in ('playing', 'over')),
  winner text check (winner in ('A', 'B', 'draw')),
  created_at timestamptz not null default now()
);

-- 행동 제출: turn 0 = 배치, 1.. = 턴. side A = 방장, B = 손님
create table public.match_moves (
  match_id uuid not null references public.matches (id) on delete cascade,
  turn int not null check (turn >= 0),
  side text not null check (side in ('A', 'B')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, turn, side)
);

alter table public.matches enable row level security;
alter table public.match_moves enable row level security;

create policy "참가자만 대전 조회" on public.matches for select to authenticated
  using (auth.uid() in (host_id, guest_id));

create or replace function public.my_side(p_match_id uuid)
returns text language sql stable security definer set search_path = public
as $$
  select case when host_id = auth.uid() then 'A' when guest_id = auth.uid() then 'B' end
  from matches where id = p_match_id
$$;

-- 양쪽이 다 낸 턴인지 (RLS 안에서 쓰므로 security definer)
create or replace function public.turn_complete(p_match_id uuid, p_turn int)
returns boolean language sql stable security definer set search_path = public
as $$ select count(*) = 2 from match_moves where match_id = p_match_id and turn = p_turn $$;

-- 상대 행동은 양쪽이 다 제출한 뒤에만 보인다 (먼저 보고 고르는 것 방지)
create policy "행동 조회" on public.match_moves for select to authenticated
  using (my_side(match_id) is not null and (side = my_side(match_id) or turn_complete(match_id, turn)));

create policy "내 행동 제출" on public.match_moves for insert to authenticated
  with check (side = my_side(match_id)
              and exists (select 1 from matches m where m.id = match_id and m.status = 'playing'));

create or replace function public.start_match(p_room_id uuid, p_host_deck jsonb)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare r public.rooms; m public.matches;
begin
  select * into r from rooms where id = p_room_id for update;
  if not found or r.host_id <> auth.uid() then raise exception '방장만 시작할 수 있습니다'; end if;
  if r.status <> 'waiting' then raise exception '이미 시작했습니다'; end if;
  if r.guest_id is null or not r.guest_ready then raise exception '상대가 준비되지 않았습니다'; end if;
  insert into matches (room_id, host_id, guest_id, turn_seconds, host_deck)
  values (r.id, r.host_id, r.guest_id, r.turn_seconds, p_host_deck) returning * into m;
  update rooms set status = 'playing', match_id = m.id, updated_at = now() where id = r.id;
  return m;
end $$;

create or replace function public.submit_guest_deck(p_match_id uuid, p_deck jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update matches set guest_deck = p_deck
  where id = p_match_id and guest_id = auth.uid() and guest_deck is null and status = 'playing';
end $$;

-- 결과 기록 (먼저 보고한 쪽 기준, 한 번만). 방은 다시 대기 상태로
create or replace function public.finish_match(p_match_id uuid, p_winner text)
returns void
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from matches where id = p_match_id for update;
  if not found or auth.uid() not in (m.host_id, m.guest_id) then raise exception 'not a participant'; end if;
  if m.status = 'over' then return; end if;
  update matches set status = 'over', winner = p_winner where id = m.id;
  if p_winner = 'draw' then
    update profiles set draws = draws + 1 where id in (m.host_id, m.guest_id);
  else
    update profiles set wins = wins + 1 where id = case when p_winner = 'A' then m.host_id else m.guest_id end;
    update profiles set losses = losses + 1 where id = case when p_winner = 'A' then m.guest_id else m.host_id end;
  end if;
  update rooms set status = 'waiting', match_id = null, guest_ready = false, updated_at = now()
  where id = m.room_id and status = 'playing';
end $$;

-- ───────────── 권한 · 실시간 ─────────────

revoke all on public.room_secrets from anon, authenticated;
grant select on public.profiles, public.rooms, public.matches, public.match_moves to authenticated;
grant insert on public.match_moves to authenticated;
-- 이 마이그레이션의 함수만 (같은 프로젝트의 다른 함수는 건드리지 않음)
revoke execute on function
  public.upsert_profile(text), public.create_room(text, text, int), public.join_room(uuid, text),
  public.leave_room(uuid), public.set_ready(uuid, boolean), public.start_match(uuid, jsonb),
  public.submit_guest_deck(uuid, jsonb), public.finish_match(uuid, text),
  public.my_side(uuid), public.turn_complete(uuid, int), public.my_nickname()
from public, anon;
grant execute on function
  public.upsert_profile(text), public.create_room(text, text, int), public.join_room(uuid, text),
  public.leave_room(uuid), public.set_ready(uuid, boolean), public.start_match(uuid, jsonb),
  public.submit_guest_deck(uuid, jsonb), public.finish_match(uuid, text),
  public.my_side(uuid), public.turn_complete(uuid, int), public.my_nickname()
to authenticated;

alter publication supabase_realtime add table public.rooms, public.matches, public.match_moves;
