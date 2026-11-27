begin;

set local lock_timeout = '5s';

-- Record observed numbers for directory conflict checks without rewriting
-- existing profiles. Older environments may already have the original phone
-- history table and recorder.
do $$
begin
  if pg_catalog.to_regclass('public.phone_history') is null then
    create table public.phone_history (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      org_id uuid not null references public.organizations(id) on delete cascade,
      phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
      valid_from timestamptz not null,
      valid_to timestamptz,
      reason text not null check (reason in ('initial', 'change', 'release', 'reuse')),
      created_at timestamptz not null default now(),
      check (valid_to is null or valid_to > valid_from)
    );
    create unique index phone_history_one_current_per_user
      on public.phone_history (user_id) where valid_to is null;
    alter table public.phone_history enable row level security;
    revoke all on public.phone_history from public, anon, authenticated, service_role;
    grant select on public.phone_history to service_role;
  end if;
end;
$$;

create index if not exists phone_history_org_read_cursor
  on public.phone_history (org_id, id);

create function private.directory_observed_phone_v1(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case
    when digits ~ '^1[3-9][0-9]{9}$' then '+86' || digits
    when digits ~ '^[1-9][0-9]{7,14}$' then '+' || digits
  end
  from (select pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) as normalized;
$$;

create function private.record_directory_observed_phone_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := private.directory_observed_phone_v1(new.phone);
  v_reason text := 'initial';
  v_observed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    if new.org_id is not distinct from old.org_id
      and v_phone is not distinct from private.directory_observed_phone_v1(old.phone) then
      return new;
    end if;

    select greatest(v_observed_at, max(history.valid_from) + interval '1 microsecond')
      into v_observed_at
    from public.phone_history as history
    where history.user_id = old.id and history.valid_to is null;

    update public.phone_history as history set valid_to = v_observed_at
    where history.user_id = old.id and history.valid_to is null;
    v_reason := case when private.directory_observed_phone_v1(old.phone) is null then 'reuse' else 'change' end;
  end if;

  if v_phone is not null and new.org_id is not null then
    insert into public.phone_history(user_id, org_id, phone, valid_from, reason)
    values (new.id, new.org_id, v_phone, v_observed_at, v_reason);
  end if;
  return new;
end;
$$;

-- A verified number belongs to the current employee profile. A differently
-- formatted copy of the same number retains its existing verification.
create function private.clear_changed_directory_phone_verification_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.directory_observed_phone_v1(new.phone)
    is distinct from private.directory_observed_phone_v1(old.phone) then
    new.phone_verified := false;
  end if;
  return new;
end;
$$;

revoke all on function private.directory_observed_phone_v1(text),
  private.record_directory_observed_phone_v1(),
  private.clear_changed_directory_phone_verification_v1()
  from public, anon, authenticated, service_role;

-- Hold writes while creating the recorder and taking an initial snapshot.
-- Conflicting holders are recorded independently for later review.
lock table public.users in share row exclusive mode;

create trigger users_clear_changed_directory_phone_verification
before update of phone on public.users
for each row when (old.phone is distinct from new.phone)
execute function private.clear_changed_directory_phone_verification_v1();
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.users'::regclass and tgname = 'users_phone_history'
      and tgenabled in ('O', 'A') and not tgisinternal
  ) then
    create trigger users_directory_observed_phone
    after insert or update of phone, org_id on public.users
    for each row execute function private.record_directory_observed_phone_v1();

    insert into public.phone_history(user_id, org_id, phone, valid_from, reason)
    select person.id, person.org_id, observed.phone, statement_timestamp(), 'initial'
    from public.users as person
    cross join lateral (select private.directory_observed_phone_v1(person.phone) as phone) observed
    where person.org_id is not null and observed.phone is not null
    on conflict do nothing;
  end if;
end;
$$;

commit;
