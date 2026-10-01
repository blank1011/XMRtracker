create table if not exists public.worker_controls (
  worker_id text primary key,
  state text not null check (state in ('paused', 'running')),
  updated_at timestamptz not null default now()
);

alter table public.worker_controls enable row level security;

revoke all on public.worker_controls from anon, authenticated;

grant select, insert, update on public.worker_controls to service_role;