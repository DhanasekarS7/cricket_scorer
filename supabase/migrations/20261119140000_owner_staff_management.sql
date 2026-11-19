-- Let only the claimed owner approve organizers and scorers by email.
create or replace function public.get_tournament_staff()
returns table (email text, role text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid()) and a.role = 'owner'
  ) then raise exception 'Owner permission required'; end if;

  return query
  select u.email::text, a.role::text
  from public.match_admins a
  join auth.users u on u.id = a.user_id
  where a.role in ('owner', 'tournament_admin', 'scorer')
  order by case a.role when 'owner' then 0 when 'tournament_admin' then 1 else 2 end, u.email;
end;
$$;

create or replace function public.approve_tournament_staff(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid()) and a.role = 'owner'
  ) then raise exception 'Owner permission required'; end if;
  if p_role not in ('tournament_admin', 'scorer') then raise exception 'Choose organizer or scorer access'; end if;

  select u.id into v_user_id from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_user_id is null then raise exception 'This person must sign in once before staff access can be approved'; end if;

  insert into public.match_admins (user_id, role) values (v_user_id, p_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;

revoke execute on function public.get_tournament_staff() from public, anon;
grant execute on function public.get_tournament_staff() to authenticated;
revoke execute on function public.approve_tournament_staff(text, text) from public, anon;
grant execute on function public.approve_tournament_staff(text, text) to authenticated;
