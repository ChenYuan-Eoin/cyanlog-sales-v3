-- WP46: persisted external organization sources and identity ledger.
-- Source 1 owns the core organization hierarchy; higher priorities enrich
-- identity and secondary evidence without silently replacing source 1.

begin;

create table if not exists public.organization_sources (
  id uuid primary key default gen_random_uuid(),
  system_org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (char_length(btrim(provider)) between 1 and 50),
  external_tenant_id text not null check (char_length(btrim(external_tenant_id)) between 1 and 255),
  priority integer not null check (priority between 1 and 100),
  status text not null default 'active' check (status in ('draft', 'active', 'disabled')),
  authority_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(authority_scope) = 'object'),
  sync_mode text not null default 'read_only' check (sync_mode in ('read_only', 'authoritative', 'enrichment')),
  last_successful_sync_at timestamptz,
  last_error text,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, system_org_id),
  unique (system_org_id, provider, external_tenant_id)
);

create unique index if not exists organization_sources_active_priority
  on public.organization_sources (system_org_id, priority)
  where status = 'active';

create index if not exists organization_sources_org_status
  on public.organization_sources (system_org_id, status, priority);

create table if not exists public.external_identities (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  system_org_id uuid not null,
  external_user_id text not null check (char_length(btrim(external_user_id)) between 1 and 255),
  external_union_id text,
  external_open_id text,
  canonical_user_id uuid references public.users(id) on delete set null,
  match_status text not null default 'unresolved'
    check (match_status in ('unresolved', 'matched', 'conflict', 'ignored')),
  match_method text not null default 'none'
    check (match_method in ('none', 'provider_id', 'employee_id', 'email', 'phone', 'manual')),
  match_confidence numeric(5, 4) not null default 0
    check (match_confidence >= 0 and match_confidence <= 1),
  profile_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profile_snapshot) = 'object'),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (source_id, system_org_id)
    references public.organization_sources(id, system_org_id)
    on delete cascade,
  unique (source_id, external_user_id)
);

create index if not exists external_identities_org_match
  on public.external_identities (system_org_id, match_status, observed_at desc);

create index if not exists external_identities_canonical_user
  on public.external_identities (canonical_user_id, system_org_id)
  where canonical_user_id is not null;

alter table public.organization_sources enable row level security;
alter table public.external_identities enable row level security;

revoke all on public.organization_sources, public.external_identities
  from public, anon, authenticated;
grant select, insert, update, delete on public.organization_sources
  to service_role;
grant select, insert, update, delete on public.external_identities
  to service_role;

comment on table public.organization_sources is
  'Tenant-owned external organization sources. Priority 1 is authoritative for core organization structure.';
comment on table public.external_identities is
  'Provider identity ledger used for conflict-safe canonical person matching.';

commit;
