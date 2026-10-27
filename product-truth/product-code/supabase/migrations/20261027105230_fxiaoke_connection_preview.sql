-- F003 / WP91. Configuration only; does not activate or mutate organization sources.
begin;
create table public.organization_fxiaoke_connections (
  system_org_id uuid primary key references public.organizations(id),
  app_id text not null,
  expected_ea text not null,
  api_user_id text not null,
  credentials_ciphertext text not null,
  revision uuid not null default gen_random_uuid(),
  last_checked_at timestamptz,
  last_check_status text not null default 'not_checked'
    check (last_check_status in ('not_checked', 'preview_ready', 'failed')),
  last_error text,
  preview_started_at timestamptz,
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  check (length(app_id) between 1 and 128),
  check (length(expected_ea) between 1 and 128),
  check (length(api_user_id) between 1 and 128),
  check (credentials_ciphertext like 'v1.%')
);
alter table public.organization_fxiaoke_connections enable row level security;
revoke all on public.organization_fxiaoke_connections from public, anon, authenticated;
grant select, insert, update on public.organization_fxiaoke_connections to service_role;
comment on table public.organization_fxiaoke_connections is
  'Server-only tenant-bound encrypted Fxiaoke credentials. Preview success is not organization activation or employee authorization.';
commit;
