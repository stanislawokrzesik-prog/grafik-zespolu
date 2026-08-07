-- ============================================================
-- MIGRACJA: zarządzanie uczestnikami, seria terminów (grupowe
-- usuwanie/edycja), wyjątki w regułach cyklicznych, wykorzystanie
-- kalendarza (alert >35%)
-- Wklej całość w Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- 1. Właściciel terminu może usuwać z niego uczestników (nie tylko admin) ----------
drop policy if exists "participants_delete" on public.event_participants;
create policy "participants_delete" on public.event_participants for delete using (
  public.is_approved() and (
    user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.events e where e.id = event_participants.event_id and e.owner_id = auth.uid())
  )
);

-- ---------- 2. Seria terminów — wspólny identyfikator do grupowych operacji ----------
alter table public.events add column if not exists series_id uuid;

-- ---------- 3. Wyjątki i podział w regułach cyklicznych (usuwanie/edycja "tego dnia",
--              "tego i przyszłych", "poprzednich", "wszystkich") ----------
alter table public.recurring_blocks add column if not exists exception_dates date[] not null default '{}';

-- dołóż exception_dates do widoku (żeby wyjątki działały też przy sprawdzaniu
-- dostępności innych osób, nie tylko właściciela reguły)
create or replace view public.recurring_busy_view as
select id, user_id, weekdays, all_day, start_time, end_time, date_from, date_until, exception_dates
from public.recurring_blocks;
grant select on public.recurring_busy_view to authenticated;

-- ---------- 4. Wykorzystanie kalendarza — do alertu >35% dla admina ----------
-- (nic dodatkowego w bazie nie trzeba — liczone po stronie aplikacji na podstawie
-- istniejących danych; ten fragment zostawiony jako placeholder gdyby trzeba było
-- przechowywać próg w app_settings)
alter table public.app_settings add column if not exists capacity_alert_threshold int not null default 35;
