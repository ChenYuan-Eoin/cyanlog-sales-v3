-- F003 / WP94. Forward-only SSO bootstrap that does not rewrite employee phone
-- data. The canonical phone-history migration remains responsible for phone
-- normalization and uniqueness after any overlapping ownership is explicitly
-- resolved.
begin;

create unique index if not exists external_identities_source_canonical_unique
  on public.external_identities (source_id, canonical_user_id)
  where match_status = 'matched' and canonical_user_id is not null;

create table if not exists public.organization_fxiaoke_oauth_states (
  state_hash text primary key,
  system_org_id uuid not null references public.organizations(id) on delete cascade,
  redirect_url text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (state_hash ~ '^[a-f0-9]{64}$'),
  check (char_length(redirect_url) between 1 and 2048),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '10 minutes')
);

create index if not exists organization_fxiaoke_oauth_states_expiry
  on public.organization_fxiaoke_oauth_states (expires_at)
  where consumed_at is null;

create or replace function public.consume_fxiaoke_oauth_state(
  p_state_hash text
) returns table (
  system_org_id uuid,
  redirect_url text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.organization_fxiaoke_oauth_states
     set consumed_at = now()
   where state_hash = lower(btrim(p_state_hash))
     and consumed_at is null
     and expires_at > now()
  returning organization_fxiaoke_oauth_states.system_org_id,
            organization_fxiaoke_oauth_states.redirect_url;
$$;

alter table public.organization_fxiaoke_oauth_states enable row level security;

revoke all on public.organization_fxiaoke_oauth_states
  from public, anon, authenticated;
revoke all on function public.consume_fxiaoke_oauth_state(text)
  from public, anon, authenticated;

grant select, insert, update, delete on public.organization_fxiaoke_oauth_states to service_role;
grant execute on function public.consume_fxiaoke_oauth_state(text) to service_role;

comment on table public.organization_fxiaoke_oauth_states is
  'Hashed, short-lived, single-use OAuth state values. Raw state values are never persisted.';
comment on function public.consume_fxiaoke_oauth_state(text) is
  'Atomically consumes one unexpired Fxiaoke OAuth state so concurrent callback replays fail.';
comment on index public.external_identities_source_canonical_unique is
  'One canonical user can have at most one stable external subject per organization source.';

commit;
