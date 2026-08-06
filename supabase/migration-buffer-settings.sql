-- ============================================================
-- MIGRACJA: bufor czasowy między zadaniami (np. czas na dojazd)
-- Wklej całość w Supabase → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.app_settings (
  id text primary key default 'default',
  buffer_minutes int not null default 120,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, buffer_minutes)
values ('default', 120)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings for select using (auth.role() = 'authenticated');

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update" on public.app_settings for update using (public.is_admin());

alter publication supabase_realtime add table public.app_settings;
