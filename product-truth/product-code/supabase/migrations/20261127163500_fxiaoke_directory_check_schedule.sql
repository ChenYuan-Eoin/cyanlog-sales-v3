begin;

create table private.fxiaoke_directory_check_schedules (
  org_id uuid not null,
  source_id uuid not null,
  interval_days integer not null default 1 check (interval_days in (0, 1, 3, 7)),
  last_auto_day date,
  attempt_id uuid,
  effective_revision uuid,
  started_at timestamptz,
  status text check (status in ('checking', 'succeeded', 'scope_unverified', 'failed')),
  error_code text,
  latest_report jsonb,
  last_reliable_report jsonb,
  primary key (org_id, source_id),
  foreign key (source_id, org_id) references public.organization_sources(id, system_org_id) on delete cascade
);

alter table private.fxiaoke_directory_check_schedules enable row level security;
revoke all on table private.fxiaoke_directory_check_schedules from public, anon, authenticated, service_role;

create function public.read_fxiaoke_directory_check_schedule_v1(p_org_id uuid, p_source_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with clock as (
    select now() at time zone 'Asia/Shanghai' as local_time
  ), schedule as (
    select source.id, source.last_successful_sync_at, source.status = 'active'
      and source.connection_state = 'verified' and source.effective_revision is not null as enabled,
      coalesce(checks.interval_days, 1) as interval_days,
      checks.last_auto_day, checks.started_at, checks.status, checks.error_code,
      checks.latest_report, checks.last_reliable_report
    from public.organization_sources as source
    left join private.fxiaoke_directory_check_schedules as checks
      on checks.org_id = source.system_org_id and checks.source_id = source.id
    where source.system_org_id = p_org_id and source.id = p_source_id and source.provider = 'fxiaoke'
  )
  select jsonb_build_object(
    'sourceId', schedule.id,
    'enabled', schedule.enabled,
    'intervalDays', schedule.interval_days,
    'lastCheckAt', schedule.started_at,
    'lastAppliedAt', schedule.last_successful_sync_at,
    'status', case
      when schedule.status = 'checking' and schedule.started_at + interval '2 minutes' <= now() then 'failed'
      else schedule.status end,
    'errorCode', case
      when schedule.status = 'checking' and schedule.started_at + interval '2 minutes' <= now() then 'DIRECTORY_CHECK_INTERRUPTED'
      else schedule.error_code end,
    'nextCheckAt', case when schedule.enabled and schedule.interval_days > 0 then (
      greatest(
        coalesce(schedule.last_auto_day + schedule.interval_days, clock.local_time::date),
        clock.local_time::date + case when clock.local_time::time >= time '17:00' then 1 else 0 end
      ) + case when clock.local_time::time >= time '11:00' and clock.local_time::time < time '17:00'
        and coalesce(schedule.last_auto_day + schedule.interval_days, clock.local_time::date) <= clock.local_time::date
        then time '17:00' else time '11:00' end
    ) at time zone 'Asia/Shanghai' end,
    'latestReport', schedule.latest_report,
    'lastReliableReport', schedule.last_reliable_report
  ) from schedule cross join clock;
$$;

create function public.set_fxiaoke_directory_check_schedule_v1(
  p_org_id uuid, p_source_id uuid, p_interval_days integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_interval_days is null or p_interval_days not in (0, 1, 3, 7) then
    raise exception 'invalid directory check interval' using errcode = '22023';
  end if;
  perform 1 from public.organization_sources where id = p_source_id and system_org_id = p_org_id
    and provider = 'fxiaoke' for update;
  if not found then return null; end if;

  insert into private.fxiaoke_directory_check_schedules (org_id, source_id, interval_days)
    values (p_org_id, p_source_id, p_interval_days)
    on conflict (org_id, source_id) do update set interval_days = excluded.interval_days;
  return public.read_fxiaoke_directory_check_schedule_v1(p_org_id, p_source_id);
end;
$$;

create function public.claim_fxiaoke_directory_checks_v1(
  p_org_id uuid, p_source_id uuid, p_limit integer
) returns table (org_id uuid, source_id uuid, effective_revision uuid, attempt_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_local_now timestamp := v_now at time zone 'Asia/Shanghai';
  v_is_manual boolean := p_org_id is not null;
  v_source record;
begin
  if (p_org_id is null) <> (p_source_id is null) or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'invalid directory check claim' using errcode = '22023';
  end if;
  if not v_is_manual and v_local_now::time < time '11:00' then return; end if;

  for v_source in
    select source.system_org_id, source.id, source.effective_revision
    from public.organization_sources as source
    left join private.fxiaoke_directory_check_schedules as checks
      on checks.org_id = source.system_org_id and checks.source_id = source.id
    where source.provider = 'fxiaoke' and source.status = 'active'
      and source.connection_state = 'verified' and source.effective_revision is not null
      and (checks.status is distinct from 'checking' or checks.started_at + interval '2 minutes' <= v_now)
      and (case when v_is_manual then source.system_org_id = p_org_id and source.id = p_source_id else
        coalesce(checks.interval_days, 1) > 0 and
        (checks.last_auto_day is null or checks.last_auto_day + checks.interval_days <= v_local_now::date) end)
    order by checks.last_auto_day nulls first, source.id
    limit p_limit
    for update of source skip locked
  loop
    -- The conditional upsert rechecks eligibility after waiting on the row. This
    -- also closes the case where the initial left join saw no schedule yet.
    return query insert into private.fxiaoke_directory_check_schedules as checks (
      org_id, source_id, last_auto_day, attempt_id, effective_revision, started_at, status
    ) values (
      v_source.system_org_id, v_source.id, case when not v_is_manual then v_local_now::date end,
      gen_random_uuid(), v_source.effective_revision, v_now, 'checking'
    ) on conflict on constraint fxiaoke_directory_check_schedules_pkey do update
      set last_auto_day = coalesce(excluded.last_auto_day, checks.last_auto_day),
          attempt_id = excluded.attempt_id,
          effective_revision = excluded.effective_revision,
          started_at = excluded.started_at,
          status = 'checking',
          error_code = null
      where (checks.status is distinct from 'checking' or checks.started_at + interval '2 minutes' <= v_now)
        and (v_is_manual or (checks.interval_days > 0 and
          (checks.last_auto_day is null or checks.last_auto_day + checks.interval_days <= v_local_now::date)))
    returning checks.org_id, checks.source_id, checks.effective_revision, checks.attempt_id;
  end loop;
end;
$$;

create function public.finish_fxiaoke_directory_check_v1(
  p_org_id uuid, p_source_id uuid, p_attempt_id uuid, p_effective_revision uuid,
  p_status text, p_error_code text, p_report jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_current boolean;
begin
  if p_status is null or p_status not in ('succeeded', 'scope_unverified', 'failed')
    or (p_status <> 'failed' and jsonb_typeof(p_report) is distinct from 'object')
    or (p_status = 'failed' and p_report is not null)
    or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,80}$') then
    raise exception 'invalid directory check result' using errcode = '22023';
  end if;
  select status = 'active' and connection_state = 'verified'
      and effective_revision = p_effective_revision into v_current
    from public.organization_sources where system_org_id = p_org_id and id = p_source_id
      and provider = 'fxiaoke' for update;

  update private.fxiaoke_directory_check_schedules
    set status = case when v_current is true then p_status else 'failed' end,
        error_code = case when v_current is true then p_error_code else 'CONFIG_CHANGED' end,
        latest_report = case when v_current is true and p_report is not null then p_report else latest_report end,
        last_reliable_report = case when v_current is true and p_status = 'succeeded' then p_report else last_reliable_report end
    where org_id = p_org_id and source_id = p_source_id and attempt_id = p_attempt_id
      and effective_revision = p_effective_revision and status = 'checking'
      and started_at + interval '2 minutes' > clock_timestamp();
  return found and v_current is true;
end;
$$;

revoke all on function public.read_fxiaoke_directory_check_schedule_v1(uuid, uuid),
  public.set_fxiaoke_directory_check_schedule_v1(uuid, uuid, integer),
  public.claim_fxiaoke_directory_checks_v1(uuid, uuid, integer),
  public.finish_fxiaoke_directory_check_v1(uuid, uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.read_fxiaoke_directory_check_schedule_v1(uuid, uuid),
  public.set_fxiaoke_directory_check_schedule_v1(uuid, uuid, integer),
  public.claim_fxiaoke_directory_checks_v1(uuid, uuid, integer),
  public.finish_fxiaoke_directory_check_v1(uuid, uuid, uuid, uuid, text, text, jsonb)
  to service_role;

commit;
