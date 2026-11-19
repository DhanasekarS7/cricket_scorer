-- Treat innings changes as reversible match state events too.
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
  v_kind text;
begin
  if (select auth.uid()) is null
    or not exists (
      select 1 from public.match_admins a
      where a.user_id = (select auth.uid())
        and a.role in ('owner', 'tournament_admin', 'scorer')
    )
  then raise exception 'Scorer permission required'; end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.match_status <> 'live' then raise exception 'Match is not live'; end if;

  v_kind := case when p_event->>'kind' = 'innings_break' then 'innings_break' else 'delivery' end;
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.match_events where match_id = p_match_id;
  insert into public.match_events (match_id, sequence, event, created_by)
  values (p_match_id, v_sequence, p_event || jsonb_build_object('state_before', v_match.state, 'state_after', p_state, 'kind', v_kind), (select auth.uid()))
  returning id into v_event_id;

  update public.matches set state = p_state, updated_at = now() where id = p_match_id;
  return v_event_id;
end;
$$;

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
  then raise exception 'Scorer permission required'; end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.match_status <> 'live' then raise exception 'Match is not live'; end if;

  select * into v_last from public.match_events
  where match_id = p_match_id and event->>'kind' in ('delivery', 'innings_break')
  order by sequence desc limit 1;
  if not found then raise exception 'There is no scoring action to undo'; end if;

  v_next_state := v_last.event->'state_before';
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.match_events where match_id = p_match_id;
  insert into public.match_events (match_id, sequence, event, created_by)
  values (p_match_id, v_sequence, jsonb_build_object('kind', 'undo', 'reverses_event_id', v_last.id, 'state_before', v_match.state, 'state_after', v_next_state), (select auth.uid()));
  update public.matches set state = v_next_state, updated_at = now() where id = p_match_id;
  return v_next_state;
end;
$$;

revoke execute on function public.record_match_event(text, jsonb, jsonb) from public, anon;
grant execute on function public.record_match_event(text, jsonb, jsonb) to authenticated;
revoke execute on function public.undo_last_match_event(text) from public, anon;
grant execute on function public.undo_last_match_event(text) to authenticated;
