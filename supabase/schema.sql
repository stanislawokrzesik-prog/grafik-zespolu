-- ============================================================
-- Grafik zespołu — schemat Supabase
-- Wklej całość w Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- TABELE ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  role text not null default 'employee' check (role in ('admin','employee')),
  approved boolean not null default false,
  color text not null default '#E8A33D',
  theme text not null default 'dark',
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  start_time text not null,
  end_time text not null,
  all_day boolean not null default false,
  location text,
  notes text,
  type text not null default 'work' check (type in ('work','block')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.event_participants (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  primary key (event_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  message text not null,
  event_id uuid,
  request_id uuid,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  to_user_id uuid not null references public.profiles(id) on delete cascade,
  conflict_event_id uuid,
  draft_event_id uuid,
  message text,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);

-- ---------- AUTOMATYCZNE TWORZENIE PROFILU PO REJESTRACJI ----------
-- Pierwsza zarejestrowana osoba automatycznie zostaje adminem i jest od razu zatwierdzona.
-- Kolejne osoby dostają rolę "employee" i czekają na zatwierdzenie przez admina w aplikacji.

create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_count int;
  palette text[] := array['#E8A33D','#3FA796','#8C8CE0','#E8637A','#5DBEE8'];
begin
  select count(*) into user_count from public.profiles;
  insert into public.profiles (id, name, email, role, approved, color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    case when user_count = 0 then 'admin' else 'employee' end,
    case when user_count = 0 then true else false end,
    palette[(user_count % 5) + 1]
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- ROW LEVEL SECURITY ----------

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.notifications enable row level security;
alter table public.join_requests enable row level security;

-- pomocnicza funkcja: czy zalogowany user jest adminem
create or replace function public.is_admin()
returns boolean as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable;

-- pomocnicza funkcja: czy zalogowany user jest zatwierdzony
create or replace function public.is_approved()
returns boolean as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved = true);
$$ language sql security definer stable;

-- profiles: każdy zalogowany widzi listę zespołu; każdy edytuje siebie; admin edytuje wszystkich
create policy "profiles_select" on public.profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update_self" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_update_admin" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

-- events: zatwierdzeni widzą wszystkie terminy; tworzy właściciel; edytuje właściciel lub admin
create policy "events_select" on public.events for select
  using (
    public.is_approved() and (
      owner_id = auth.uid()
      or public.is_admin()
      or exists (select 1 from public.event_participants ep where ep.event_id = events.id and ep.user_id = auth.uid())
    )
  );
create policy "events_insert" on public.events for insert with check (public.is_approved() and owner_id = auth.uid());
create policy "events_update" on public.events for update using (public.is_approved() and (owner_id = auth.uid() or public.is_admin()));
create policy "events_delete" on public.events for delete using (public.is_approved() and (owner_id = auth.uid() or public.is_admin()));

-- widok z minimalnymi danymi terminu (bez tytułu/lokalizacji/notatek) — widoczny dla
-- każdego zatwierdzonego użytkownika, potrzebny do wykrywania konfliktów bez ujawniania
-- treści cudzych terminów
create or replace view public.event_busy_view as
select e.id as event_id, e.date, e.start_time, e.end_time, e.all_day, e.owner_id, ep.user_id, ep.status
from public.events e
join public.event_participants ep on ep.event_id = e.id
where ep.status <> 'declined';

grant select on public.event_busy_view to authenticated;

-- event_participants: zatwierdzeni widzą wszystko (potrzebne do wykrywania konfliktów);
-- dopisywać uczestników może każdy zatwierdzony; zmieniać status (akceptuj/odrzuć) tylko sam siebie lub admin
create policy "participants_select" on public.event_participants for select using (public.is_approved());
create policy "participants_insert" on public.event_participants for insert with check (public.is_approved());
create policy "participants_update" on public.event_participants for update using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));
create policy "participants_delete" on public.event_participants for delete using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));

-- notifications: każdy widzi/oznacza/usuwa tylko swoje; wysyłać (insert) może każdy zatwierdzony
create policy "notifications_select" on public.notifications for select using (user_id = auth.uid() or public.is_admin());
create policy "notifications_insert" on public.notifications for insert with check (public.is_approved());
create policy "notifications_update" on public.notifications for update using (user_id = auth.uid() or public.is_admin());
create policy "notifications_delete" on public.notifications for delete using (user_id = auth.uid() or public.is_admin());

-- join_requests: widzi nadawca/odbiorca/admin; tworzy nadawca; zmienia status odbiorca/admin
create policy "join_requests_select" on public.join_requests for select using (from_user_id = auth.uid() or to_user_id = auth.uid() or public.is_admin());
create policy "join_requests_insert" on public.join_requests for insert with check (public.is_approved() and from_user_id = auth.uid());
create policy "join_requests_update" on public.join_requests for update using (to_user_id = auth.uid() or public.is_admin());

-- audit_log: log aktywności, widoczny tylko dla admina; każdy zatwierdzony user zapisuje własne akcje
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy "audit_log_select_admin" on public.audit_log for select using (public.is_admin());
create policy "audit_log_insert" on public.audit_log for insert with check (actor_id = auth.uid());

-- recurring_blocks: cykliczna niedostępność (np. co wtorek/czwartek w godz. 8-16)
create table if not exists public.recurring_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Niedostępny/a',
  weekdays int[] not null,
  all_day boolean not null default false,
  start_time text,
  end_time text,
  date_from date not null,
  date_until date,
  created_at timestamptz not null default now()
);
alter table public.recurring_blocks enable row level security;
create policy "recurring_select" on public.recurring_blocks for select using (public.is_approved() and (user_id = auth.uid() or public.is_admin()));
create policy "recurring_insert" on public.recurring_blocks for insert with check (public.is_approved() and user_id = auth.uid());
create policy "recurring_update" on public.recurring_blocks for update using (user_id = auth.uid() or public.is_admin());
create policy "recurring_delete" on public.recurring_blocks for delete using (user_id = auth.uid() or public.is_admin());

create or replace view public.recurring_busy_view as
select id, user_id, weekdays, all_day, start_time, end_time, date_from, date_until
from public.recurring_blocks;
grant select on public.recurring_busy_view to authenticated;

-- ---------- REALTIME ----------
-- Włącza natychmiastowe aktualizacje (bez tego trzeba by odpytywać bazę ręcznie)
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.event_participants;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.join_requests;
alter publication supabase_realtime add table public.audit_log;
