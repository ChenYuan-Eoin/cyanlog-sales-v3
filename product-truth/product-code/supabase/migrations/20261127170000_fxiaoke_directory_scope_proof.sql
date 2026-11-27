begin;

-- Admin evidence is separate from the provider's paginated contents. Retain
-- only fingerprints, provenance and counts. The manifest rows are not stored.
create table private.fxiaoke_directory_scope_proofs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_id uuid not null,
  connection_revision uuid not null,
  actor_id uuid not null,
  proof_format text not null default 'fx-roster-v1' check (proof_format = 'fx-roster-v1'),
  external_tenant_id text not null,
  tenant_ea text not null,
  tenant_corp_id text not null check (tenant_corp_id ~ '^FSCID_[A-Za-z0-9_-]+$'),
  principal_digest text not null check (principal_digest ~ '^[0-9a-f]{64}$'),
  root_department_id text not null check (root_department_id <> '' and length(root_department_id) <= 255),
  captured_at timestamptz not null,
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  department_export_digest text not null check (department_export_digest ~ '^[0-9a-f]{64}$'),
  employee_export_digest text not null check (employee_export_digest ~ '^[0-9a-f]{64}$'),
  roster_digest text not null check (roster_digest ~ '^[0-9a-f]{64}$'),
  department_count integer not null check (department_count between 1 and 5000),
  employee_count integer not null check (employee_count between 1 and 5000),
  check (external_tenant_id in (tenant_ea, tenant_corp_id)),
  check (captured_at <= verified_at and verified_at < expires_at
    and expires_at <= captured_at + interval '30 minutes'),
  foreign key (source_id, org_id) references public.organization_sources(id, system_org_id) on delete cascade
);

create index fxiaoke_directory_scope_proofs_latest
  on private.fxiaoke_directory_scope_proofs (org_id, source_id, connection_revision, captured_at desc, verified_at desc, id desc);
alter table private.fxiaoke_directory_scope_proofs enable row level security;
revoke all on table private.fxiaoke_directory_scope_proofs from public, anon, authenticated, service_role;

create function public.record_fxiaoke_directory_scope_proof_v1(
  p_org_id uuid, p_source_id uuid, p_actor_id uuid, p_connection_revision uuid,
  p_external_tenant_id text, p_source_updated_at timestamptz,
  p_tenant_ea text, p_tenant_corp_id text, p_principal_digest text, p_root_department_id text,
  p_captured_at timestamptz, p_department_export_digest text, p_employee_export_digest text,
  p_roster_digest text, p_department_count integer, p_employee_count integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz;
  v_proof private.fxiaoke_directory_scope_proofs%rowtype;
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  perform 1 from public.organization_sources as source
   where source.id = p_source_id and source.system_org_id = p_org_id
     and source.provider = 'fxiaoke' and source.status = 'active' and source.connection_state = 'verified'
     and source.external_tenant_id = p_external_tenant_id
     and source.configuration_revision = p_connection_revision and source.effective_revision = p_connection_revision
     and source.updated_at = p_source_updated_at
   for update;
  if not found then
    raise exception 'directory connection changed while verifying the independent roster' using errcode = '40001';
  end if;

  v_now := clock_timestamp();
  if p_captured_at is null or p_captured_at > v_now or p_captured_at + interval '30 minutes' <= v_now then
    raise exception 'directory scope proof is expired' using errcode = '23514', detail = 'SCOPE_PROOF_EXPIRED';
  end if;

  insert into private.fxiaoke_directory_scope_proofs (
    org_id, source_id, connection_revision, actor_id, external_tenant_id, tenant_ea, tenant_corp_id, principal_digest,
    root_department_id, captured_at, verified_at, expires_at, department_export_digest, employee_export_digest,
    roster_digest, department_count, employee_count
  ) values (
    p_org_id, p_source_id, p_connection_revision, p_actor_id, p_external_tenant_id, p_tenant_ea, p_tenant_corp_id, p_principal_digest,
    p_root_department_id, p_captured_at, v_now, p_captured_at + interval '30 minutes', p_department_export_digest, p_employee_export_digest,
    p_roster_digest, p_department_count, p_employee_count
  ) returning * into v_proof;
  return jsonb_build_object('id', v_proof.id, 'capturedAt', v_proof.captured_at,
    'verifiedAt', v_proof.verified_at, 'expiresAt', v_proof.expires_at,
    'departmentCount', v_proof.department_count, 'employeeCount', v_proof.employee_count);
end;
$$;

create function private.latest_fxiaoke_directory_scope_proof_v1(p_org_id uuid, p_source_id uuid, p_connection_revision uuid)
returns private.fxiaoke_directory_scope_proofs language sql stable set search_path = '' as $$
  select proof.* from private.fxiaoke_directory_scope_proofs as proof
   where proof.org_id = p_org_id and proof.source_id = p_source_id and proof.connection_revision = p_connection_revision
   order by proof.captured_at desc, proof.verified_at desc, proof.id desc limit 1;
$$;

create function public.read_fxiaoke_directory_scope_proof_v1(
  p_org_id uuid, p_source_id uuid, p_connection_revision uuid, p_external_tenant_id text,
  p_principal_digest text, p_root_department_id text, p_roster_digest text
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', proof.id, 'rosterDigest', proof.roster_digest, 'expiresAt', proof.expires_at)
  from public.organization_sources as source
  cross join lateral private.latest_fxiaoke_directory_scope_proof_v1(p_org_id, p_source_id, p_connection_revision) as proof
  where source.id = p_source_id and source.system_org_id = p_org_id
    and source.provider = 'fxiaoke' and source.status = 'active' and source.connection_state = 'verified'
    and source.external_tenant_id = p_external_tenant_id and proof.external_tenant_id = p_external_tenant_id
    and source.configuration_revision = p_connection_revision and source.effective_revision = p_connection_revision
    and proof.principal_digest = p_principal_digest and proof.root_department_id = p_root_department_id
    and proof.roster_digest = p_roster_digest and proof.expires_at > statement_timestamp();
$$;

-- Use the same exact organization scope and effective stored grant as the
-- application. Checking under the organization lock keeps the confirmation
-- consistent with concurrent role and membership changes.
create function private.directory_apply_actor_allowed_v1(p_org_id uuid, p_actor_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.organizations as organization
    join public.user_organizations as member
      on member.org_id = organization.id and member.user_id = p_actor_id
    join public.users as person on person.id = member.user_id
    join public.user_roles as assignment
      on assignment.org_id = organization.id and assignment.user_id = p_actor_id
      and assignment.scope_type = 'org' and assignment.scope_id = organization.id
    join private.org_role_catalog_v1(p_org_id, false) as role on role.id = assignment.role_id
    where organization.id = p_org_id and organization.status = 'active'
      and person.status = 'active' and person.login_enabled is true
      and member.status = 'active' and member.employment_status = 'active' and member.left_at is null
      and (
        (role.code = 'SUPER_ADMIN' and role.owner_org_id is null and member.is_default)
        or (role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
          and private.shipping_role_effective_scope_permissions_v1(
            role.code, role.id, organization.settings, role.permissions
          ) ? 'org:source_apply')
      )
  );
$$;

revoke all on function private.directory_apply_actor_allowed_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

alter function public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid)
  rename to apply_organization_directory_before_scope_proof_v1;
alter function public.apply_organization_directory_before_scope_proof_v1(uuid, uuid, text, uuid, jsonb, uuid)
  set schema private;

create function public.apply_organization_directory_cutover_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_connection_revision uuid,
  p_source_revisions jsonb, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_source public.organization_sources%rowtype;
  v_proof private.fxiaoke_directory_scope_proofs%rowtype;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  if not private.directory_apply_actor_allowed_v1(p_system_org_id, p_actor_id) then
    raise exception 'organization directory confirmation is forbidden' using errcode = '42501';
  end if;

  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;

  if v_plan.status = 'planned' then
    perform 1 from public.organization_sources as source
      where source.system_org_id = p_system_org_id order by source.id for update;
    select * into v_source from public.organization_sources as source
      where source.id = v_plan.target_source_id and source.system_org_id = p_system_org_id;
    if not found then raise exception 'directory cutover target source is missing' using errcode = '23514'; end if;

    if v_source.provider = 'fxiaoke' then
      select * into v_proof from private.latest_fxiaoke_directory_scope_proof_v1(p_system_org_id, v_source.id, p_connection_revision);
      if v_source.status is distinct from 'active' or v_source.connection_state is distinct from 'verified'
        or v_source.configuration_revision is distinct from p_connection_revision
        or v_source.effective_revision is distinct from p_connection_revision
        or v_plan.connection_revision is distinct from p_connection_revision
        or v_proof.id is null or v_proof.expires_at <= clock_timestamp()
        or v_proof.external_tenant_id is distinct from v_source.external_tenant_id
        or v_plan.plan_payload->>'targetExternalTenantId' is distinct from v_source.external_tenant_id
        or v_plan.plan_payload #> '{snapshot,scopeVerified}' is distinct from 'true'::jsonb
        or v_plan.plan_payload #>> '{snapshot,scopeEvidence}' is distinct from
          (v_proof.proof_format || ':' || v_proof.id::text || ':' || v_proof.roster_digest) then
        raise exception 'Fxiaoke directory has no current matching scope evidence'
          using errcode = '23514', detail = 'DIRECTORY_SCOPE_UNVERIFIED';
      end if;
    end if;
  end if;

  -- Keep permission review and receipt behavior of the already deployed path.
  return private.apply_organization_directory_before_scope_proof_v1(
    p_system_org_id, p_plan_id, p_plan_hash, p_connection_revision, p_source_revisions, p_actor_id);
end;
$$;

revoke all on function private.latest_fxiaoke_directory_scope_proof_v1(uuid, uuid, uuid),
  private.apply_organization_directory_before_scope_proof_v1(uuid, uuid, text, uuid, jsonb, uuid),
  public.record_fxiaoke_directory_scope_proof_v1(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, timestamptz, text, text, text, integer, integer),
  public.read_fxiaoke_directory_scope_proof_v1(uuid, uuid, uuid, text, text, text, text),
  public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_fxiaoke_directory_scope_proof_v1(uuid, uuid, uuid, uuid, text, timestamptz, text, text, text, text, timestamptz, text, text, text, integer, integer),
  public.read_fxiaoke_directory_scope_proof_v1(uuid, uuid, uuid, text, text, text, text),
  public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid)
  to service_role;

commit;
