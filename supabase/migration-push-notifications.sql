-- ============================================================
-- MIGRACJA: prawdziwe powiadomienia push (działają nawet gdy
-- aplikacja jest zamknięta / telefon zablokowany)
-- Wklej całość w Supabase → SQL Editor → New query → Run
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_sub_select" on public.push_subscriptions;
create policy "push_sub_select" on public.push_subscriptions for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "push_sub_insert" on public.push_subscriptions;
create policy "push_sub_insert" on public.push_subscriptions for insert with check (user_id = auth.uid());

drop policy if exists "push_sub_delete" on public.push_subscriptions;
create policy "push_sub_delete" on public.push_subscriptions for delete using (user_id = auth.uid());

-- Edge Function (send-push) czyta subskrypcje via service_role, więc nie potrzebuje
-- dodatkowej polityki — service_role zawsze omija RLS.
