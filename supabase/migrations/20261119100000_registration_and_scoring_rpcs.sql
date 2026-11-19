-- Allow public team applications only while registration is open.
grant insert on public.team_registrations to anon, authenticated;
drop policy if exists "Public can submit team registration while open" on public.team_registrations;
create policy "Public can submit team registration while open"
  on public.team_registrations for insert to anon, authenticated
  with check (
    status = 'pending'
    and team_id is null
    and reviewed_at is null
    and reviewed_by is null
    and exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.registration_open = true
    )
  );

-- Only owners and tournament administrators can create fixtures.
grant insert on public.matches to authenticated;
drop policy if exists "Tournament staff can schedule matches" on public.matches;
create policy "Tournament staff can schedule matches"
  on public.matches for insert to authenticated
  with check (
    tournament_id is not null
    and team_a_id is not null
    and team_b_id is not null
    and team_a_id <> team_b_id
    and exists (
      select 1 from public.match_admins a
      where a.user_id = (select auth.uid())
        and a.role in ('owner', 'tournament_admin')
    )
  );

-- Approval/rejection and team creation are one transaction.
create or replace function public.review_team_registration(p_registration_id uuid, p_decision text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.team_registrations%rowtype;
  v_team_id uuid;
begin
  if (select auth.uid()) is null
    or not exists (
      select 1 from public.match_admins a
      where a.user_id = (select auth.uid())
        and a.role in ('owner', 'tournament_admin')
    )
  then
    raise exception 'Tournament administrator permission required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_registration
  from public.team_registrations
  where id = p_registration_id
  for update;

  if not found then
    raise exception 'Registration not found';
  end if;
  if v_registration.status <> 'pending' then
    raise exception 'Registration has already been reviewed';
  end if;

  if p_decision = 'approved' then
    insert into public.teams (tournament_id, name, short_name, status)
    values (
      v_registration.tournament_id,
      v_registration.team_name,
      upper(left(regexp_replace(v_registration.team_name, '[^A-Za-z0-9]', '', 'g'), 4)),
      'approved'
    )
    on conflict (tournament_id, name)
    do update set status = 'approved'
    returning id into v_team_id;
  end if;

  update public.team_registrations
  set status = p_decision,
      team_id = v_team_id,
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where id = p_registration_id;

  return v_team_id;
end;
$$;

revoke execute on function public.review_team_registration(uuid, text) from public, anon;
grant execute on function public.review_team_registration(uuid, text) to authenticated;

-- Record a delivery and its resulting scoreboard atomically while locking the match.
create or replace function public.record_match_event(p_match_id text, p_event jsonb, p_state jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_sequence integer;
  v_event_id bigint;
begin
  if (select auth.uid()) is null
    or not exists (
      select 1 from public.match_admins a
      where a.user_id = (select auth.uid())
        and a.role in ('owner', 'tournament_admin', 'scorer')
    )
  then
    raise exception 'Scorer permission required';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found or v_match.match_status <> 'live' then
    raise exception 'Match is not live';
  end if;

  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.match_events
  where match_id = p_match_id;

  insert into public.match_events (match_id, sequence, event, created_by)
  values (
    p_match_id,
    v_sequence,
    p_event || jsonb_build_object('state_before', v_match.state, 'state_after', p_state, 'kind', 'delivery'),
    (select auth.uid())
  )
  returning id into v_event_id;

  update public.matches
  set state = p_state, updated_at = now()
  where id = p_match_id;

  return v_event_id;
end;
$$;

-- Undo by restoring the previous state and writing an audit event; never delete history.
create or replace function public.undo_last_match_event(p_match_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_last public.match_events%rowtype;
  v_sequence integer;
  v_next_state jsonb;
begin
  if (select auth.uid()) is null
    or not exists (
      select 1 from public.match_admins a
      where a.user_id = (select auth.uid())
        and a.role in ('owner', 'tournament_admin', 'scorer')
    )
  then
    raise exception 'Scorer permission required';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found or v_match.match_status <> 'live' then
    raise exception 'Match is not live';
  end if;

  select * into v_last
  from public.match_events
  where match_id = p_match_id and event->>'kind' = 'delivery'
  order by sequence desc
  limit 1;

  if not found then
    raise exception 'There is no delivery to undo';
  end if;

  v_next_state := v_last.event->'state_before';

  select coalesce(max(sequence), 0) + 1 into v_sequence
  from public.match_events
  where match_id = p_match_id;

  insert into public.match_events (match_id, sequence, event, created_by)
  values (
    p_match_id,
    v_sequence,
    jsonb_build_object(
      'kind', 'undo',
      'reverses_event_id', v_last.id,
      'state_before', v_match.state,
      'state_after', v_next_state
    ),
    (select auth.uid())
  );

  update public.matches
  set state = v_next_state, updated_at = now()
  where id = p_match_id;

  return v_next_state;
end;
$$;

revoke execute on function public.record_match_event(text, jsonb, jsonb) from public, anon;
grant execute on function public.record_match_event(text, jsonb, jsonb) to authenticated;
revoke execute on function public.undo_last_match_event(text) from public, anon;
grant execute on function public.undo_last_match_event(text) to authenticated;
