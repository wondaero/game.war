-- 보유 유닛·재화·덱·뽑기 난수를 서버에 저장 (사용자당 한 줄, 앱 저장 형식 그대로)
-- 쓰기는 서버 함수(game)만 한다. 사용자는 자기 것을 읽기만 가능.

create table public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.saves enable row level security;
create policy "내 저장 조회" on public.saves for select to authenticated using (user_id = auth.uid());
grant select on public.saves to authenticated;

-- 서버에 저장된 덱 (덱 순서대로 유닛 데이터). 대전 덱은 이것만 쓴다 → 앱에서 덱을 조작해 보낼 수 없음
create or replace function public.deck_of(p_user uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(u.value order by d.ord), '[]'::jsonb)
  from saves s
  cross join lateral jsonb_array_elements_text(s.data -> 'deck') with ordinality as d(id, ord)
  join lateral jsonb_array_elements(s.data -> 'inventory') as u(value) on u.value ->> 'id' = d.id
  where s.user_id = p_user
$$;

drop function public.start_match(uuid, jsonb);
drop function public.submit_guest_deck(uuid, jsonb);
drop function public.finish_match(uuid, text);

create or replace function public.start_match(p_room_id uuid)
returns public.matches
language plpgsql security definer set search_path = public
as $$
declare r public.rooms; m public.matches; d jsonb;
begin
  select * into r from rooms where id = p_room_id for update;
  if not found or r.host_id <> auth.uid() then raise exception '방장만 시작할 수 있습니다'; end if;
  if r.status <> 'waiting' then raise exception '이미 시작했습니다'; end if;
  if r.guest_id is null or not r.guest_ready then raise exception '상대가 준비되지 않았습니다'; end if;
  d := deck_of(auth.uid());
  if jsonb_array_length(d) <> 4 then raise exception '덱을 먼저 편성하세요 (4명)'; end if;
  insert into matches (room_id, host_id, guest_id, turn_seconds, host_deck)
  values (r.id, r.host_id, r.guest_id, r.turn_seconds, d) returning * into m;
  update rooms set status = 'playing', match_id = m.id, updated_at = now() where id = r.id;
  return m;
end $$;

create or replace function public.submit_guest_deck(p_match_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare d jsonb;
begin
  d := deck_of(auth.uid());
  if jsonb_array_length(d) <> 4 then raise exception '덱을 먼저 편성하세요 (4명)'; end if;
  update matches set guest_deck = d
  where id = p_match_id and guest_id = auth.uid() and guest_deck is null and status = 'playing';
end $$;

-- 결과 기록: 서버 함수(game)가 행동 기록을 다시 계산해서 확인한 뒤에만 호출 (service_role 전용)
create or replace function public.finish_match_verified(p_match_id uuid, p_winner text)
returns void
language plpgsql security definer set search_path = public
as $$
declare m public.matches;
begin
  select * into m from matches where id = p_match_id for update;
  if not found or m.status = 'over' then return; end if;
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

revoke execute on function public.deck_of(uuid), public.start_match(uuid), public.submit_guest_deck(uuid),
  public.finish_match_verified(uuid, text) from public, anon;
revoke execute on function public.deck_of(uuid), public.finish_match_verified(uuid, text) from authenticated;
grant execute on function public.start_match(uuid), public.submit_guest_deck(uuid) to authenticated;
grant execute on function public.finish_match_verified(uuid, text) to service_role;
