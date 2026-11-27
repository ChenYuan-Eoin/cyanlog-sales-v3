begin;

create table private.fxiaoke_credential_rotation_trials (
  org_id uuid not null,
  source_id uuid not null,
  trial_id uuid not null default gen_random_uuid() unique,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  draft_revision uuid not null,
  effective_revision uuid not null,
  source_updated_at timestamptz not null,
  member_id uuid not null,
  external_user_id text not null,
  actor_id uuid not null,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  verified_at timestamptz,
  promoted_at timestamptz,
  primary key (org_id, source_id),
  foreign key (source_id, org_id) references public.organization_sources(id, system_org_id) on delete cascade
);
alter table private.fxiaoke_credential_rotation_trials enable row level security;
revoke all on table private.fxiaoke_credential_rotation_trials from public, anon, authenticated, service_role;

create function private.fxiaoke_rotation_eligible_members(p_org_id uuid, p_source_id uuid)
returns table(member_id uuid, external_user_id text, display_name text)
language sql stable set search_path = '' as $$
  select person.id, identity.external_user_id, person.display_name::text
  from public.external_identities identity
  join public.users person on person.id = identity.canonical_user_id
    and person.org_id = p_org_id and person.status = 'active' and person.login_enabled
  join public.user_organizations membership on membership.user_id = person.id
    and membership.org_id = p_org_id and membership.is_default
    and membership.status = 'active' and membership.employment_status = 'active'
  where identity.source_id = p_source_id and identity.system_org_id = p_org_id
    and identity.match_status = 'matched'
    and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
    and not exists (
      select 1 from public.external_identities other
      where other.system_org_id = p_org_id and other.source_id = p_source_id
        and other.canonical_user_id = person.id and other.id <> identity.id
    );
$$;

create function public.read_fxiaoke_credential_rotation_v1(p_org_id uuid, p_actor_id uuid, p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  return jsonb_build_object(
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', member_id, 'name', display_name) order by display_name, member_id)
      from private.fxiaoke_rotation_eligible_members(p_org_id, p_source_id)), '[]'::jsonb),
    'trial', (
      select jsonb_build_object('id', trial.trial_id, 'memberId', trial.member_id,
        'expiresAt', trial.expires_at, 'verifiedAt', trial.verified_at)
      from private.fxiaoke_credential_rotation_trials trial
      join public.organization_sources source on source.id = trial.source_id and source.system_org_id = trial.org_id
      where trial.org_id = p_org_id and trial.source_id = p_source_id and trial.expires_at > now()
        and trial.promoted_at is null and source.updated_at = trial.source_updated_at
    ));
end;
$$;

create function public.create_fxiaoke_credential_rotation_v1(
  p_org_id uuid, p_actor_id uuid, p_source_id uuid, p_member_id uuid, p_draft_revision uuid,
  p_effective_revision uuid, p_source_updated_at timestamptz, p_token_hash text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_external_user_id text;
  v_trial private.fxiaoke_credential_rotation_trials%rowtype;
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  perform 1 from public.organization_sources source
  where source.id = p_source_id and source.system_org_id = p_org_id and source.provider = 'fxiaoke'
    and source.status = 'active' and source.connection_state = 'verified'
    and source.authority_scope->>'identity' = 'authoritative' and source.draft_check_status = 'preview_ready'
    and source.configuration_revision = p_draft_revision and source.effective_revision = p_effective_revision
    and source.configuration_revision <> source.effective_revision and source.updated_at = p_source_updated_at
  for update;
  if not found then return null; end if;
  select external_user_id into v_external_user_id
    from private.fxiaoke_rotation_eligible_members(p_org_id, p_source_id) where member_id = p_member_id;
  if not found then return null; end if;
  insert into private.fxiaoke_credential_rotation_trials(org_id, source_id, token_hash, draft_revision,
    effective_revision, source_updated_at, member_id, external_user_id, actor_id)
  values(p_org_id, p_source_id, p_token_hash, p_draft_revision,
    p_effective_revision, p_source_updated_at, p_member_id, v_external_user_id, p_actor_id)
  on conflict (org_id, source_id) do update
    set trial_id = excluded.trial_id, token_hash = excluded.token_hash, draft_revision = excluded.draft_revision,
      effective_revision = excluded.effective_revision, source_updated_at = excluded.source_updated_at,
      member_id = excluded.member_id, external_user_id = excluded.external_user_id, actor_id = excluded.actor_id,
      expires_at = excluded.expires_at, verified_at = null, promoted_at = null
  returning * into v_trial;
  return jsonb_build_object('id', v_trial.trial_id, 'memberId', v_trial.member_id,
    'expiresAt', v_trial.expires_at, 'verifiedAt', v_trial.verified_at);
end;
$$;

create function public.resolve_fxiaoke_credential_rotation_v1(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', trial.trial_id, 'orgId', trial.org_id, 'sourceId', trial.source_id,
    'revision', trial.draft_revision, 'sourceUpdatedAt', trial.source_updated_at)
  from private.fxiaoke_credential_rotation_trials trial
  join public.organization_sources source on source.id = trial.source_id and source.system_org_id = trial.org_id
  where trial.token_hash = p_token_hash and trial.expires_at > now() and trial.verified_at is null
    and source.updated_at = trial.source_updated_at and source.configuration_revision = trial.draft_revision
    and source.effective_revision = trial.effective_revision;
$$;

create function public.complete_fxiaoke_credential_rotation_v1(
  p_org_id uuid, p_trial_id uuid, p_draft_revision uuid, p_external_user_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  update private.fxiaoke_credential_rotation_trials trial set verified_at = now()
  from public.organization_sources source
  where trial.org_id = p_org_id and trial.trial_id = p_trial_id
    and trial.external_user_id = p_external_user_id and trial.expires_at > now() and trial.verified_at is null
    and trial.draft_revision = p_draft_revision and source.id = trial.source_id and source.system_org_id = p_org_id
    and source.configuration_revision = trial.draft_revision and source.effective_revision = trial.effective_revision
    and source.updated_at = trial.source_updated_at
    and exists (select 1 from private.fxiaoke_rotation_eligible_members(p_org_id, trial.source_id) member
      where member.member_id = trial.member_id and member.external_user_id = trial.external_user_id);
  return found;
end;
$$;

create function public.promote_fxiaoke_credential_rotation_v1(p_org_id uuid, p_actor_id uuid, p_trial_id uuid, p_draft_revision uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_trial private.fxiaoke_credential_rotation_trials%rowtype;
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  select * into v_trial from private.fxiaoke_credential_rotation_trials
    where org_id = p_org_id and trial_id = p_trial_id and draft_revision = p_draft_revision
      and expires_at > now() and verified_at is not null and promoted_at is null for update;
  if not found then return false; end if;
  if not exists (select 1 from private.fxiaoke_rotation_eligible_members(p_org_id, v_trial.source_id) member
       where member.member_id = v_trial.member_id and member.external_user_id = v_trial.external_user_id)
  then return false; end if;

  update public.organization_sources source set
    previous_effective_revision = source.effective_revision,
    previous_effective_credentials_ciphertext = source.effective_credentials_ciphertext,
    previous_effective_credential_envelope = source.effective_credential_envelope,
    previous_effective_metadata = source.effective_metadata,
    previous_effective_connection_state = source.connection_state,
    effective_revision = source.configuration_revision,
    effective_credentials_ciphertext = source.draft_credentials_ciphertext,
    effective_credential_envelope = source.draft_credential_envelope,
    effective_metadata = source.draft_metadata,
    last_verified_at = source.draft_checked_at,
    last_error = null,
    last_error_at = null,
    lifecycle_audit = coalesce(source.lifecycle_audit, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'command', 'promoted', 'actorId', p_actor_id, 'occurredAt', now(), 'trialId', v_trial.trial_id,
      'configurationRevision', p_draft_revision, 'effectiveRevision', p_draft_revision,
      'state', 'verified', 'detail', 'employee_authentication_verified')),
    updated_by = p_actor_id, updated_at = now()
  where source.system_org_id = p_org_id and source.id = v_trial.source_id and source.provider = 'fxiaoke'
    and source.status = 'active' and source.connection_state = 'verified'
    and source.authority_scope->>'identity' = 'authoritative' and source.draft_check_status = 'preview_ready'
    and source.configuration_revision = p_draft_revision and source.effective_revision = v_trial.effective_revision
    and source.updated_at = v_trial.source_updated_at;
  if not found then return false; end if;
  update private.fxiaoke_credential_rotation_trials set promoted_at = now() where trial_id = v_trial.trial_id;
  return true;
end;
$$;

revoke all on function private.fxiaoke_rotation_eligible_members(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_fxiaoke_credential_rotation_v1(uuid, uuid, uuid),
  public.create_fxiaoke_credential_rotation_v1(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text),
  public.resolve_fxiaoke_credential_rotation_v1(text), public.complete_fxiaoke_credential_rotation_v1(uuid, uuid, uuid, text),
  public.promote_fxiaoke_credential_rotation_v1(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_fxiaoke_credential_rotation_v1(uuid, uuid, uuid),
  public.create_fxiaoke_credential_rotation_v1(uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text),
  public.resolve_fxiaoke_credential_rotation_v1(text), public.complete_fxiaoke_credential_rotation_v1(uuid, uuid, uuid, text),
  public.promote_fxiaoke_credential_rotation_v1(uuid, uuid, uuid, uuid) to service_role;

commit;
