begin;

create or replace function public.apply_organization_directory_cutover_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_connection_revision uuid,
  p_source_revisions jsonb, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_provider text;
  v_had_controller boolean;
  v_projection jsonb;
  v_changes jsonb;
  v_result jsonb;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;

  if v_plan.status = 'planned' then
    -- Match the delegate's source lock order so the checked provider stays stable through apply.
    perform 1 from public.organization_sources
      where system_org_id = p_system_org_id order by id for update;
    select source.provider into v_provider from public.organization_sources as source
      where source.id = v_plan.target_source_id and source.system_org_id = p_system_org_id;
    if not found then
      raise exception 'directory cutover target source is missing' using errcode = '23514';
    end if;
    if v_provider = 'fxiaoke' then
      if v_plan.plan_payload->>'organizationId' is distinct from p_system_org_id::text
        or v_plan.plan_payload->>'targetProvider' is distinct from v_provider then
        raise exception 'directory cutover plan target or organization mismatch' using errcode = '23514';
      end if;
      if v_plan.plan_payload #> '{snapshot,scopeVerified}' is distinct from 'true'::jsonb
        or jsonb_typeof(v_plan.plan_payload #> '{snapshot,scopeEvidence}') is distinct from 'string'
        or coalesce(v_plan.plan_payload #>> '{snapshot,scopeEvidence}', '') !~ '[^[:space:]]' then
        raise exception 'Fxiaoke directory scope is unverified'
          using errcode = '23514', detail = 'DIRECTORY_SCOPE_UNVERIFIED';
      end if;
    end if;
  end if;

  v_had_controller := private.has_effective_system_super_admin_v1(p_system_org_id);
  if v_plan.status = 'planned' and v_plan.plan_payload->'applyable' = 'true'::jsonb then
    v_projection := private.directory_transfer_projection_v1(p_system_org_id, v_plan.plan_payload);
    v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
    if v_plan.plan_payload->'authorityReview' is distinct from
      private.directory_transfer_commitment_v1(v_projection, v_changes) then
      raise exception 'directory authority changed after preview'
        using errcode = '40001', detail = 'DIRECTORY_AUTHORITY_PREVIEW_STALE';
    end if;
  end if;
  if v_projection is not null then
    perform private.apply_directory_transfer_review_v1(p_system_org_id, p_actor_id, v_changes);
  end if;
  v_result := private.apply_organization_directory_cutover_v1(
    p_system_org_id, p_plan_id, p_plan_hash, p_connection_revision, p_source_revisions, p_actor_id);
  if v_projection is not null then
    perform private.assert_directory_transfer_projection_v1(p_system_org_id, v_projection);
  end if;
  perform private.assert_system_super_admin_continuity_v1(p_system_org_id, v_had_controller);
  return v_result;
end;
$$;

commit;
