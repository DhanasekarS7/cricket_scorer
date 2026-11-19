-- Exclude deliveries already reversed so repeated undo clicks walk the score back.
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

  select * into v_last
  from public.match_events e
  where e.match_id = p_match_id
    and e.event->>'kind' in ('delivery', 'innings_break')
    and not exists (
      select 1 from public.match_events u
      where u.match_id = e.match_id
        and u.event->>'kind' = 'undo'
        and u.event->>'reverses_event_id' = e.id::text
    )
  order by e.sequence desc limit 1;
  if not found then raise exception 'There is no scoring action to undo'; end if;

  v_next_state := v_last.event->'state_before';
  select coalesce(max(sequence), 0) + 1 into v_sequence from public.match_events where match_id = p_match_id;
  insert into public.match_events (match_id, sequence, event, created_by)
  values (p_match_id, v_sequence, jsonb_build_object('kind', 'undo', 'reverses_event_id', v_last.id, 'state_before', v_match.state, 'state_after', v_next_state), (select auth.uid()));
  update public.matches set state = v_next_state, updated_at = now() where id = p_match_id;
  return v_next_state;
end;
$$;

revoke execute on function public.undo_last_match_event(text) from public, anon;
grant execute on function public.undo_last_match_event(text) to authenticated;
