-- F054: employee email identity is scoped to shipping intake, not backend login.
-- Settings start disabled. Business domain values are entered in configuration,
-- never inferred from a request or seeded as application environment variables.
begin;

create table public.shipping_email_access_settings (
  org_id uuid primary key references public.organizations(id),
  enabled boolean not null default false,
  allowed_domains text[] not null default '{}',
  smtp_host text,
  smtp_port integer not null default 465 check (smtp_port in (465, 587)),
  smtp_secure boolean not null default true,
  from_email text,
  from_name text not null default '自助收寄',
  credentials_ciphertext text,
  connection_status text not null default 'unconfigured'
    check (connection_status in ('unconfigured', 'configured', 'verified', 'failed')),
  last_tested_at timestamptz,
  last_error_kind text check (last_error_kind in ('configuration', 'authentication', 'connection', 'delivery')),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(allowed_domains) <= 20),
  check (not enabled or cardinality(allowed_domains) > 0),
  check (char_length(from_name) between 1 and 80),
  check ((smtp_port = 465 and smtp_secure) or (smtp_port = 587 and not smtp_secure))
);

create table public.shipping_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  is_active boolean not null default true,
  session_version bigint not null default 1 check (session_version > 0),
  email_verified_at timestamptz not null default now(),
  sender_contact jsonb check (sender_contact is null or jsonb_typeof(sender_contact) = 'object'),
  team text check (team is null or char_length(team) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email),
  unique (id, org_id)
);

create table public.shipping_email_challenges (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'accepted', 'failed', 'unknown')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index shipping_email_challenges_email_time on public.shipping_email_challenges(org_id, email, created_at desc);
create index shipping_email_challenges_ip_time on public.shipping_email_challenges(org_id, ip_hash, created_at desc);

create table public.shipping_employee_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  org_id uuid not null references public.organizations(id),
  employee_id uuid not null,
  issued_version bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (employee_id, org_id) references public.shipping_employee_profiles(id, org_id)
);
create index shipping_employee_sessions_employee on public.shipping_employee_sessions(employee_id, org_id);

alter table public.shipping_email_access_settings enable row level security;
alter table public.shipping_employee_profiles enable row level security;
alter table public.shipping_email_challenges enable row level security;
alter table public.shipping_employee_sessions enable row level security;
revoke all on public.shipping_email_access_settings, public.shipping_employee_profiles,
  public.shipping_email_challenges, public.shipping_employee_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.shipping_email_access_settings, public.shipping_employee_profiles,
  public.shipping_email_challenges, public.shipping_employee_sessions to service_role;

-- Reservation is serialized by organization/email and IP so concurrent requests
-- cannot bypass cooldown or retain multiple valid challenges for one mailbox.
create function public.reserve_shipping_email_challenge(
  p_id uuid, p_org_id uuid, p_email text, p_code_hash text, p_ip_hash text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_id is null or p_org_id is null or p_email is null or p_email <> lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
    or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (select 1 from public.shipping_email_access_settings s
    where s.org_id = p_org_id and s.enabled and split_part(p_email, '@', 2) = any(s.allowed_domains)) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shipping-email:' || p_org_id::text || ':' || p_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('shipping-email-ip:' || p_org_id::text || ':' || p_ip_hash, 0));
  if exists (select 1 from public.shipping_employee_profiles where org_id = p_org_id and email = p_email and not is_active) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if exists (select 1 from public.shipping_email_challenges
    where org_id = p_org_id and email = p_email and created_at > now() - interval '60 seconds') then
    return jsonb_build_object('status', 'rate_limited', 'retryAfter', 60);
  end if;
  if (select count(*) from public.shipping_email_challenges where org_id = p_org_id and email = p_email and created_at > now() - interval '1 hour') >= 5
    or (select count(*) from public.shipping_email_challenges where org_id = p_org_id and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 100 then
    return jsonb_build_object('status', 'rate_limited', 'retryAfter', 3600);
  end if;
  update public.shipping_email_challenges set consumed_at = now()
    where org_id = p_org_id and email = p_email and consumed_at is null;
  insert into public.shipping_email_challenges(id, org_id, email, code_hash, ip_hash, expires_at)
    values (p_id, p_org_id, p_email, p_code_hash, p_ip_hash, now() + interval '10 minutes');
  return jsonb_build_object('status', 'reserved', 'challengeId', p_id);
end;
$$;

-- A correct code can create exactly one scoped session, even with concurrent
-- verification requests. Existing profiles are never re-enabled by verification.
create function public.verify_shipping_email_challenge(
  p_id uuid, p_org_id uuid, p_email text, p_code_hash text, p_session_hash text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  challenge public.shipping_email_challenges%rowtype;
  employee public.shipping_employee_profiles%rowtype;
begin
  if p_id is null or p_org_id is null or p_email is null or p_email <> lower(btrim(p_email))
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$'
    or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (select 1 from public.shipping_email_access_settings s
    where s.org_id = p_org_id and s.enabled and split_part(p_email, '@', 2) = any(s.allowed_domains)) then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into challenge from public.shipping_email_challenges
    where id = p_id and org_id = p_org_id and email = p_email for update;
  if not found or challenge.consumed_at is not null or challenge.expires_at <= now() or challenge.attempts >= 5 then
    return jsonb_build_object('status', 'invalid');
  end if;
  update public.shipping_email_challenges set attempts = attempts + 1 where id = p_id;
  if challenge.code_hash <> p_code_hash then return jsonb_build_object('status', 'invalid'); end if;
  insert into public.shipping_employee_profiles(org_id, email)
    values (p_org_id, p_email) on conflict (org_id, email) do nothing;
  select * into employee from public.shipping_employee_profiles
    where org_id = p_org_id and email = p_email for update;
  if not employee.is_active then return jsonb_build_object('status', 'invalid'); end if;
  update public.shipping_email_challenges set consumed_at = now() where id = p_id;
  update public.shipping_employee_profiles set email_verified_at = now() where id = employee.id;
  insert into public.shipping_employee_sessions(token_hash, org_id, employee_id, issued_version, expires_at)
    values (p_session_hash, p_org_id, employee.id, employee.session_version, now() + interval '60 days');
  return jsonb_build_object('status', 'verified', 'employeeId', employee.id);
end;
$$;

revoke all on function public.reserve_shipping_email_challenge(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_shipping_email_challenge(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_shipping_email_challenge(uuid, uuid, text, text, text) to service_role;
grant execute on function public.verify_shipping_email_challenge(uuid, uuid, text, text, text) to service_role;

comment on table public.shipping_employee_profiles is 'Email-verified shipping submitters and their personal sender preferences; no backend operator permissions.';
comment on table public.shipping_employee_sessions is 'Opaque shipping-intake sessions; only token hashes are persisted. Recheck profile activity, session version and domain policy on each request.';
-- Immutable employee ownership is separate from operator-editable sales labels.
alter table public.shipping_orders add column employee_profile_id uuid;
alter table public.shipping_orders add constraint shipping_orders_employee_org_fk
  foreign key (employee_profile_id, org_id) references public.shipping_employee_profiles(id, org_id);
create index shipping_orders_employee_created_idx on public.shipping_orders(org_id, employee_profile_id, created_at desc) where employee_profile_id is not null;

-- Identity and workorder ownership must be installed or rolled back together.
commit;
