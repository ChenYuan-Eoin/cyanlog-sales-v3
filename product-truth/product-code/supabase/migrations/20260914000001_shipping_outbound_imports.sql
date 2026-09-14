-- Personal SF website history, separate from API-created shipping requests.
create table if not exists public.shipping_outbound_imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id),
  waybill text not null check (waybill ~ '^(SF)?[0-9]{10,15}$'),
  source_time text not null default '',
  source_status text not null default '',
  source_rank integer not null check (source_rank >= 0),
  verification_suffix text not null check (verification_suffix ~ '^[0-9]{4}$'),
  source_url text not null check (source_url = 'https://www.sf-express.com/chn/sc/waybill/list'),
  imported_at timestamptz not null default now(),
  unique (created_by, waybill)
);
alter table public.shipping_outbound_imports enable row level security;
revoke all on public.shipping_outbound_imports from public, anon, authenticated;
grant select, insert, update on public.shipping_outbound_imports to service_role;
