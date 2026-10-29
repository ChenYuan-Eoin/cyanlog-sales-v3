-- F003 / WP94. Server-only OAuth state and canonical identity constraints.
-- Stable federated identities use the existing organization_sources /
-- external_identities ledger. users.id remains the only canonical subject;
-- phone is an authentication entry and display value, never an authorization FK.
-- This migration introduces no parallel identity source and keeps the active
-- database singular (cyanlog-sales-v3).
begin;

-- Normalize existing phone values before adding identity constraints. Provider
-- values are expected to include a country code; an 11-digit mainland China
-- mobile number is the only local form accepted through the +86 default.
create or replace function private.normalize_identity_phone_v1(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
begin
  if p_phone is null or btrim(p_phone) = '' then
    return null;
  end if;

  v_digits := regexp_replace(btrim(p_phone), '[^0-9]', '', 'g');
  if v_digits ~ '^1[3-9][0-9]{9}$' then
    return '+86' || v_digits;
  end if;
  if v_digits ~ '^861[3-9][0-9]{9}$' then
    return '+' || v_digits;
  end if;
  if v_digits ~ '^[1-9][0-9]{7,14}$' then
    return '+' || v_digits;
  end if;

  raise exception 'invalid identity phone format'
    using errcode = '22023';
end;
$$;

revoke all on function private.normalize_identity_phone_v1(text)
  from public, anon, authenticated;
grant execute on function private.normalize_identity_phone_v1(text)
  to service_role;

update public.users
   set phone = private.normalize_identity_phone_v1(phone),
       employee_id = nullif(btrim(employee_id), ''),
       updated_at = now()
 where phone is not null
    or employee_id is distinct from nullif(btrim(employee_id), '');

do $$
begin
  if exists (
    select 1
      from public.users
     where status = 'active'
       and phone is not null
     group by org_id, phone
    having count(*) > 1
  ) then
    raise exception 'active users contain duplicate normalized phone values'
      using errcode = '23505';
  end if;

  if exists (
    select 1
      from public.users
     where status = 'active'
       and employee_id is not null
     group by org_id, employee_id
    having count(*) > 1
  ) then
    raise exception 'active users contain duplicate employee_id values'
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists users_active_org_phone_unique
  on public.users (org_id, phone)
  where status = 'active' and phone is not null;

create unique index if not exists users_active_org_employee_id_unique
  on public.users (org_id, employee_id)
  where status = 'active' and employee_id is not null;

create table if not exists public.phone_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  reason text not null check (reason in ('initial', 'change', 'release', 'reuse')),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists phone_history_one_current_per_user
  on public.phone_history (user_id)
  where valid_to is null;

create unique index if not exists phone_history_one_current_owner_per_number
  on public.phone_history (org_id, phone)
  where valid_to is null;

create index if not exists phone_history_org_phone_period
  on public.phone_history (org_id, phone, valid_from, valid_to);

-- btree_gist is PostgreSQL's standard way to combine equality columns with a
-- range overlap in one exclusion constraint. On Supabase the extension lives
-- in the extensions schema.
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions, pg_temp;
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.phone_history'::regclass
       and conname = 'phone_history_no_overlap_excl'
  ) then
    alter table public.phone_history
      add constraint phone_history_no_overlap_excl
      exclude using gist (
        org_id with =,
        phone with =,
        tstzrange(valid_from, valid_to, '[)') with &&
      );
  end if;
end;
$$;
reset search_path;

create or replace function private.record_user_phone_history_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if tg_op = 'INSERT' then
    if new.phone is not null then
      insert into public.phone_history(user_id, org_id, phone, valid_from, reason)
      values (new.id, new.org_id, new.phone, v_now, 'initial');
    end if;
    return new;
  end if;

  if new.phone is not distinct from old.phone and new.org_id is not distinct from old.org_id then
    return new;
  end if;

  update public.phone_history
     set valid_to = v_now
   where user_id = old.id
     and valid_to is null;

  if new.phone is not null then
    insert into public.phone_history(user_id, org_id, phone, valid_from, reason)
    values (
      new.id,
      new.org_id,
      new.phone,
      v_now,
      case when old.phone is null then 'reuse' else 'change' end
    );
  end if;

  return new;
end;
$$;

drop trigger if exists users_phone_history on public.users;
create trigger users_phone_history
after insert or update of phone, org_id
on public.users
for each row execute function private.record_user_phone_history_v1();

insert into public.phone_history(user_id, org_id, phone, valid_from, reason)
select user_row.id, user_row.org_id, user_row.phone, now(), 'initial'
  from public.users as user_row
 where user_row.phone is not null
   and not exists (
     select 1
       from public.phone_history as history
      where history.user_id = user_row.id
        and history.valid_to is null
   );

create unique index if not exists external_identities_source_canonical_unique
  on public.external_identities (source_id, canonical_user_id)
  where match_status = 'matched' and canonical_user_id is not null;

alter table public.phone_history enable row level security;
revoke all on public.phone_history from public, anon, authenticated;
grant select, insert, update on public.phone_history to service_role;
revoke all on function private.record_user_phone_history_v1()
  from public, anon, authenticated;

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
comment on table public.phone_history is
  'Non-overlapping phone ownership intervals. users.id is the only subject; current phone is never an authorization key.';
comment on constraint phone_history_no_overlap_excl on public.phone_history is
  'PostgreSQL exclusion constraint: one phone number cannot have overlapping ownership intervals in one organization.';
comment on index public.external_identities_source_canonical_unique is
  'One canonical user can have at most one stable external subject per organization source.';

commit;
