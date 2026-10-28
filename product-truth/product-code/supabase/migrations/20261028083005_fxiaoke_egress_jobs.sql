-- WP91: short-lived, server-only Fxiaoke requests. No organization/member writes.
create table public.organization_fxiaoke_egress (
  system_org_id uuid primary key references public.organizations(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  observed_ip inet,
  status text not null check (status in ('ready','ip_changed','unreachable'))
);
create table public.organization_fxiaoke_egress_jobs (
  id uuid primary key,
  system_org_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','finished')),
  request_ciphertext text,
  response_ciphertext text,
  lease_token uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '60 seconds')
);
create index fxiaoke_egress_jobs_claim on public.organization_fxiaoke_egress_jobs(system_org_id,created_at) where status = 'queued';
create index fxiaoke_egress_jobs_expiry on public.organization_fxiaoke_egress_jobs(expires_at);
alter table public.organization_fxiaoke_egress enable row level security;
alter table public.organization_fxiaoke_egress_jobs enable row level security;
revoke all on public.organization_fxiaoke_egress, public.organization_fxiaoke_egress_jobs from public, anon, authenticated;
grant select,insert,update,delete on public.organization_fxiaoke_egress, public.organization_fxiaoke_egress_jobs to service_role;

create function public.claim_fxiaoke_egress_job(p_org_id uuid)
returns setof public.organization_fxiaoke_egress_jobs
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.organization_fxiaoke_egress_jobs where system_org_id = p_org_id and expires_at <= now();
  return query
  update public.organization_fxiaoke_egress_jobs j set status = 'running', lease_token = gen_random_uuid()
  where j.id = (
    select q.id from public.organization_fxiaoke_egress_jobs q
    where q.system_org_id = p_org_id and q.status = 'queued' and q.expires_at > now()
    order by q.created_at for update skip locked limit 1
  ) returning j.*;
end;
$$;
revoke all on function public.claim_fxiaoke_egress_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_fxiaoke_egress_job(uuid) to service_role;
