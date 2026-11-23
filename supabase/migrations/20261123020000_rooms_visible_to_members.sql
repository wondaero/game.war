-- 닫힌 방도 그 방의 참가자에게는 보이게 → 방장이 나가면 손님이 실시간 알림을 바로 받음
-- (방 목록 조회는 앱에서 status <> 'closed' 로 거른다)
drop policy "열린 방 조회" on public.rooms;
create policy "열린 방 또는 내 방 조회" on public.rooms for select to authenticated
  using (status <> 'closed' or auth.uid() in (host_id, guest_id));
