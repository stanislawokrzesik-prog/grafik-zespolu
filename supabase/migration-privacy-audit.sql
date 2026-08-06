-- ============================================================
-- MIGRACJA: prywatność terminów + log aktywności
-- Wklej całość w Supabase → SQL Editor → New query → Run
-- (bezpieczne do uruchomienia na już działającym projekcie)
-- ============================================================

-- ---------- 1. Ukrywanie szczegółów terminu przed osobami postronnymi ----------
-- Do tej pory każdy zatwierdzony użytkownik widział WSZYSTKIE dane każdego terminu
-- (tytuł, lokalizację, notatki). Teraz: pełne dane widzi właściciel terminu,
-- zaproszeni uczestnicy i admin. Pozostali widzą tylko że dana osoba jest zajęta
-- (godziny + kto), bez tytułu/lokalizacji/notatek.

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events for select
  using (
    public.is_approved() and (
      owner_id = auth.uid()
      or public.is_admin()
      or exists (select 1 from public.event_participants ep where ep.event_id = events.id and ep.user_id = auth.uid())
    )
  );

-- Widok z minimalnymi danymi (bez tytułu/lokalizacji/notatek), widoczny dla każdego
-- zatwierdzonego użytkownika — potrzebny do wykrywania konfliktów terminów.
create or replace view public.event_busy_view as
select e.id as event_id, e.date, e.start_time, e.end_time, e.owner_id, ep.user_id, ep.status
from public.events e
join public.event_participants ep on ep.event_id = e.id
where ep.status <> 'declined';

grant select on public.event_busy_view to authenticated;

-- ---------- 2. Log aktywności (widoczny tylko dla admina) ----------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_select_admin" on public.audit_log;
create policy "audit_log_select_admin" on public.audit_log for select using (public.is_admin());

drop policy if exists "audit_log_insert" on public.audit_log;
create policy "audit_log_insert" on public.audit_log for insert with check (actor_id = auth.uid());

alter publication supabase_realtime add table public.audit_log;
