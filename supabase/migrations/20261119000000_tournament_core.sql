-- Core Powerplay Arena tournament data.
-- Roles reuse public.match_admins: owner, tournament_admin (organizer), scorer, viewer.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'setup'
    check (status in ('setup', 'registration_open', 'registration_closed', 'in_progress', 'completed')),
  registration_open boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  short_name text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);

-- Contact information stays private to the tournament staff.
create table if not exists public.team_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  team_name text not null,
  captain_name text not null,
  contact_email text,
  contact_phone text,
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

-- Keep the existing match and event records. Add tournament scheduling metadata
-- to the existing match table so its live score JSON and audit events remain intact.
alter table public.matches
  add column if not exists tournament_id uuid references public.tournaments(id) on delete set null,
  add column if not exists team_a_id uuid references public.teams(id) on delete set null,
  add column if not exists team_b_id uuid references public.teams(id) on delete set null,
  add column if not exists scheduled_at timestamptz,
  add column if not exists match_status text not null default 'upcoming'
    check (match_status in ('upcoming', 'live', 'completed', 'cancelled')),
  add column if not exists venue text;

create index if not exists teams_tournament_status_idx
  on public.teams (tournament_id, status);
create index if not exists registrations_tournament_status_idx
  on public.team_registrations (tournament_id, status, submitted_at desc);
create index if not exists matches_tournament_status_schedule_idx
  on public.matches (tournament_id, match_status, scheduled_at);

alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.team_registrations enable row level security;

grant select on public.tournaments to anon, authenticated;
grant insert, update, delete on public.tournaments to authenticated;
grant select on public.teams to anon, authenticated;
grant insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_registrations to authenticated;

drop policy if exists "Public can read tournaments" on public.tournaments;
create policy "Public can read tournaments"
  on public.tournaments for select to anon, authenticated
  using (true);

drop policy if exists "Staff can manage tournaments" on public.tournaments;
create policy "Staff can manage tournaments"
  on public.tournaments for all to authenticated
  using (exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid())
      and a.role in ('owner', 'tournament_admin')
  ))
  with check (exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid())
      and a.role in ('owner', 'tournament_admin')
  ));

drop policy if exists "Public can read approved teams" on public.teams;
create policy "Public can read approved teams"
  on public.teams for select to anon, authenticated
  using (status = 'approved');

drop policy if exists "Staff can read and manage teams" on public.teams;
create policy "Staff can read and manage teams"
  on public.teams for all to authenticated
  using (exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid())
      and a.role in ('owner', 'tournament_admin')
  ))
  with check (exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid())
      and a.role in ('owner', 'tournament_admin')
  ));

drop policy if exists "Staff can manage registrations" on public.team_registrations;
create policy "Staff can manage registrations"
  on public.team_registrations for all to authenticated
  using (exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid())
      and a.role in ('owner', 'tournament_admin')
  ))
  with check (exists (
    select 1 from public.match_admins a
    where a.user_id = (select auth.uid())
      and a.role in ('owner', 'tournament_admin')
  ));

insert into public.tournaments (slug, name, status, registration_open, settings)
values (
  'powerplay-arena',
  'Powerplay Arena',
  'setup',
  false,
  '{
    "playersPerTeam": 5,
    "oversPerInnings": 4,
    "wicketsPerInnings": 4,
    "inningsPerMatch": 2,
    "overRules": [
      {"over": 1, "name": "Powerplay", "allowedChoices": [2, 3, 4, 6], "doubleRuns": false, "pairWicket": false},
      {"over": 2, "name": "Double Trouble", "allowedChoices": [1, 2, 3, 4, 6], "doubleRuns": true, "pairWicket": true},
      {"over": 3, "name": "Bowler’s Challenge", "allowedChoices": [3, 4, 6], "doubleRuns": false, "pairWicket": false},
      {"over": 4, "name": "Super Finish", "batterChoices": [0, 1, 2, 3, 4, 5, 6], "bowlerChoices": [1, 2, 3, 4, 5, 6], "doubleRuns": false, "pairWicket": false}
    ],
    "extras": {"wideEnabled": true, "widePenalty": 1, "noBallEnabled": true, "noBallPenalty": 1}
  }'::jsonb
)
on conflict (slug) do nothing;
