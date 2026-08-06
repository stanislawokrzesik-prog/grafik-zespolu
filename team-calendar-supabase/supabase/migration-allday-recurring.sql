-- ============================================================
-- MIGRACJA: "cały dzień" + cykliczna niedostępność
-- Wklej całość w Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- 1. Zdarzenia całodniowe ----------
alter table public.events add column if not exists all_day boolean not null default false;

-- dołóż all_day do widoku "zajęty/a" (bez tego cały dzień pokazywał się cudzoziemcom jako 00:00–23:59)
create or replace view public.event_busy_view as
select e.id as event_id, e.date, e.start_time, e.end_time, e.all_day, e.owner_id, ep.user_id, ep.status
from public.events e
join public.event_participants ep on ep.event_id = e.id
where ep.status <> 'declined';

-- ---------- 2. Cykliczna niedostępność ----------
create table if not exists public.recurring_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Niedostępny/a',
  weekdays int[] not null,           -- 0=Pon .. 6=Nie
  all_day boolean not null default false,
  start_time text,                   -- null gdy all_day
  end_time text,                     -- null gdy all_day
  date_from date not null,
  date_until date,                   -- null = bezterminowo
  created_at timestamptz not null default now()
);

alter table public.recurring_blocks enable row level security;

drop policy if exists "recurring_select" on public.recurring_blocks;
create policy "recurring_select" on public.recurring_blocks for select using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

drop policy if exists "recurring_insert" on public.recurring_blocks;
create policy "recurring_insert" on public.recurring_blocks for insert with check (public.is_approved() and user_id = auth.uid());

drop policy if exists "recurring_update" on public.recurring_blocks;
create policy "recurring_update" on public.recurring_blocks for update using (user_id = auth.uid() or public.is_admin());

drop policy if exists "recurring_delete" on public.recurring_blocks;
create policy "recurring_delete" on public.recurring_blocks for delete using (user_id = auth.uid() or public.is_admin());

-- widok bez etykiety (treści) — widoczny dla wszystkich zatwierdzonych, do wykrywania konfliktów
create or replace view public.recurring_busy_view as
select id, user_id, weekdays, all_day, start_time, end_time, date_from, date_until
from public.recurring_blocks;

grant select on public.recurring_busy_view to authenticated;

alter publication supabase_realtime add table public.recurring_blocks;
