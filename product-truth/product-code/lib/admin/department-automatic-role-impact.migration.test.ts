// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { connectionMigration, preCutoverBaseline, productionSchemaDatabase } from '../organization-connections/schema-baseline/database'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = '11111111-1111-4111-8111-111111111111'
const worker = '22222222-2222-4222-8222-222222222222'
const pending = '99999999-9999-4999-8999-999999999999'
const source = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const team = '55555555-5555-4555-8555-555555555555'
const ruleDepartment = '66666666-6666-4666-8666-666666666666'
const role = '77777777-7777-4777-8777-777777777777'
const migration = (file: string) => readFileSync('supabase/migrations/' + file, 'utf8')

async function setup(provider = 'feishu') {
  const db = await productionSchemaDatabase(preCutoverBaseline)
  try {
    await db.exec(connectionMigration)
    await db.exec(migration('20261103120000_organization_directory_cutover.sql'))
    await db.exec(`
      create table private.employee_permission_overrides (
        org_id uuid, user_id uuid, permission_code text, effect text, scope jsonb, updated_by uuid,
        updated_at timestamptz not null default now(), pending_target_revision text
      );
      create table if not exists public.fxiaoke_pending_org_roles (
        org_id uuid, user_id uuid, role_id uuid, granted_by uuid, granted_at timestamptz
      );
      create table if not exists public.personnel_invitations (
        org_id uuid, status text, role_ids uuid[]
      );
      create table if not exists public.department_lead_access (
        org_id uuid, user_id uuid, department_id uuid, confirmed_at timestamptz, confirmed_by uuid
      );
      create table public.automatic_role_audit_fixture (
        org_id uuid, user_id uuid, command text, before_state jsonb, after_state jsonb
      );
      create function private.shipping_role_scope_catalog_v1()
        returns table(code text,supported_scope_types text[]) language sql stable as $$
          select 'shipping:ledger_view'::text, array['org','department']::text[];
      $$;
      create function private.shipping_role_effective_scope_permissions_v1(text,uuid,jsonb,jsonb)
        returns jsonb language sql stable as $$ select $4; $$;
      create function private.org_role_catalog_v1(uuid,boolean)
        returns table(id uuid,code text,name text,permissions jsonb) language sql stable as $$
          select definition.id, definition.code, definition.name, definition.permissions
          from public.roles as definition join public.organizations as org on org.id = $1
          where org.status = 'active';
      $$;
      create function public.admin_merge_duplicate_identity_v1(uuid,uuid,uuid,uuid,text,text)
        returns jsonb language sql as $$ select '{}'::jsonb; $$;
      create function private.personnel_is_org_control_admin_v1(uuid,uuid)
        returns boolean language sql as $$ select true; $$;
      create function private.personnel_insert_event_v1(uuid,uuid,uuid,text,jsonb,jsonb,text,text)
        returns void language sql as $$
          insert into public.automatic_role_audit_fixture values ($1, $2, $4, $5, $6);
        $$;
      ${migration('20261021000006_personnel_lifecycle_commands.sql').match(/create or replace function private\.personnel_lock_org_v1\([\s\S]*?\n\$\$;/)?.[0]}
    `)
    await db.exec(migration('20261126050925_directory_system_super_admin_guard.sql'))
    await db.exec(migration('20261127145000_department_change_authority.sql'))
    await db.exec(migration('20261127152500_directory_transfer_authority.sql'))
    await db.exec(migration('20261127154000_department_automatic_role_rules.sql'))
    await db.exec(migration('20261127155000_department_automatic_role_impact.sql'))
    await db.exec(migration('20261127155500_department_authority_tree_scope.sql'))
    await db.exec(migration('20261127160000_department_parent_change.sql'))
    await db.exec(`
      insert into public.organizations (id,name,settings) values ('${org}','Impact organization','{}');
      insert into public.departments (id,org_id,name,source,external_id,status) values
        ('${team}','${org}','Team','${provider}','team','active'),
        ('${ruleDepartment}','${org}','Rule department','${provider}','rule-department','active');
      insert into public.users (id,org_id,display_name,primary_dept_id,status,login_enabled) values
        ('${actor}','${org}','Admin',null,'active',true),
        ('${worker}','${org}','Active member','${team}','active',true),
        ('${pending}','${org}','Pending member','${team}','inactive',false);
      insert into public.user_organizations
        (membership_id,user_id,org_id,primary_department_id,status,employment_status,is_default) values
        (gen_random_uuid(),'${actor}','${org}',null,'active','active',true),
        (gen_random_uuid(),'${worker}','${org}','${team}','active','active',true),
        (gen_random_uuid(),'${pending}','${org}','${team}','invited','active',true);
      insert into public.user_departments (user_id,department_id,org_id,source,is_primary) values
        ('${worker}','${team}','${org}','${provider}',true), ('${pending}','${team}','${org}','${provider}',true);
      insert into public.roles(id,code,name,permissions) values ('${role}','SALES','Sales','["shipping:ledger_view"]');
      insert into private.department_automatic_role_rules(org_id,department_id,role_id,include_subdepartments)
        values ('${org}','${ruleDepartment}','${role}',true);
      insert into public.user_roles(user_id,org_id,role_id,scope_type,scope_id)
        values ('${worker}','${org}','${role}','department','${team}');
      insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
        values ('${org}','${worker}','shipping:ledger_view','ALLOW','{"type":"org"}');
      insert into public.organization_sources(
        id,system_org_id,provider,external_tenant_id,priority,status,sync_mode,
        configuration_revision,connection_state,effective_revision
      ) values ('${source}','${org}','${provider}','tenant',1,'active','authoritative','${revision}','verified','${revision}');
    `)
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

async function withServiceRole<T>(db: Awaited<ReturnType<typeof setup>>, execute: () => Promise<T>) {
  await db.exec('set role service_role')
  try {
    return await execute()
  } finally {
    await db.exec('reset role')
  }
}

it.each([
  { provider: 'feishu', scenario: 'role source', scopeOnly: false },
  { provider: 'fxiaoke', scenario: 'role source', scopeOnly: false },
  { provider: 'feishu', scenario: 'existing role scope', scopeOnly: true },
  { provider: 'fxiaoke', scenario: 'existing role scope', scopeOnly: true },
])('confirms $provider tree-only changes to $scenario and rollback without touching manual grants and personal settings', async ({ provider, scopeOnly }) => {
  const db = await setup(provider)
  try {
    if (scopeOnly) {
      await db.query(`insert into private.department_automatic_role_rules(org_id,department_id,role_id,include_subdepartments)
        values ($1,$2,$3,true)`, [org, team, role])
    }
    const before = (await db.query<{ state: unknown }>(
      'select private.organization_directory_state_v1($1,$2,array[$3::uuid]) as state', [org, source, worker],
    )).rows[0].state
    const revisions = (await db.query<{ revisions: unknown }>(`
      select jsonb_agg(jsonb_build_object('id', id, 'provider', provider, 'priority', priority, 'status', status,
        'syncMode', sync_mode, 'configurationRevision', configuration_revision,
        'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by id) as revisions
      from public.organization_sources where system_org_id = $1
    `, [org])).rows[0].revisions
    const payload = {
      version: 'f003-directory-cutover-v2', organizationId: org, targetProvider: provider,
      targetSourceId: source, targetExternalTenantId: 'tenant', connectionRevision: revision,
      previousPrimarySourceId: null, sourceRevisions: revisions,
      snapshot: { directoryHash: 'a'.repeat(64), complete: true, connectionVerified: true, scopeVerified: true },
      conflicts: [], applyable: true,
      departmentChanges: [
        { kind: scopeOnly ? 'unchanged' : 'updated', externalId: 'team', existingDepartmentId: team, name: 'Team', parentExternalId: scopeOnly ? null : 'rule-department', status: 'active' },
        { kind: scopeOnly ? 'updated' : 'unchanged', externalId: 'rule-department', existingDepartmentId: ruleDepartment, name: 'Rule department', parentExternalId: scopeOnly ? 'team' : null, status: 'active' },
      ],
      identityChanges: [{
        kind: 'added', canonicalUserId: worker, externalUserId: 'employee', active: true, createsMember: false,
        departmentExternalIds: ['team'], matchMethod: 'employee_id', confidence: 1, displayName: 'Active member',
        profileSnapshot: { primaryDepartmentExternalId: 'team', departmentExternalIds: ['team'], status: 'active' },
      }],
      userDepartmentChanges: [{
        userId: worker, externalUserId: 'employee', departmentExternalIds: ['team'], primaryDepartmentExternalId: 'team', active: true,
      }],
      beforeState: before, staleTargetDepartmentIds: [],
    }
    const store = () => db.query<{ id: string; plan_hash: string; plan_payload: unknown }>(`
      select id,plan_hash,plan_payload from public.store_organization_directory_authority_plan_v1(
        $1,$2,$3,null,repeat('a',64),$4,$5,now()+interval '10 minutes')
    `, [org, source, revision, JSON.stringify(payload), actor]).then(result => result.rows[0])
    const apply = (plan: Awaited<ReturnType<typeof store>>) => withServiceRole(db, () => db.query<{ run: unknown }>(
      'select public.apply_organization_directory_cutover_v1($1,$2,$3,$4,$5,$6) as run',
      [org, plan.id, plan.plan_hash, revision, JSON.stringify(revisions), actor],
    ))
    const first = await store()
    const expectedForward = {
      members: 0, rolesForReview: 0, personalExceptions: 0,
      automaticRoleSourcesAdded: scopeOnly ? 0 : 1, automaticRoleSourcesRemoved: 0,
      automaticRoleScopeWidenedMembers: scopeOnly ? 1 : 0, automaticRoleScopeNarrowedMembers: 0,
      automaticRoleAffectedMembers: 1,
    }
    expect(first.plan_payload).toMatchObject({ authorityReview: { summary: expectedForward } })
    const localImpact = (await db.query<{ impact: unknown }>(`
      with projected as (select private.directory_transfer_projection_v1($1,$2) as snapshot)
      select private.directory_department_authority_impact_v1($1,snapshot->'before_tree',snapshot->'after_tree') as impact from projected
    `, [org, JSON.stringify(payload)])).rows[0].impact
    expect(localImpact).toEqual({ revision: expect.stringMatching(/^[0-9a-f]{64}$/), summary: expect.objectContaining(expectedForward) })
    expect((await db.query('select command from public.automatic_role_audit_fixture')).rows).toEqual([])
    await db.query('update public.roles set permissions = $1 where id = $2', [JSON.stringify(['shipping:ledger_view', 'dept:view']), role])
    await expect(apply(first)).rejects.toMatchObject({ detail: 'DIRECTORY_AUTHORITY_PREVIEW_STALE' })
    const fresh = await store()
    expect((await apply(fresh)).rows[0].run).toMatchObject({ status: 'applied' })
    expect((await db.query('select affiliation_department_id,permissions from public.department_automatic_role_sources_v1($1,$2)', [org, worker])).rows)
      .toEqual([{ affiliation_department_id: team, permissions: ['dept:view', 'shipping:ledger_view'] }])
    expect((await db.query('select role_id from public.department_automatic_role_sources_v1($1,$2)', [org, pending])).rows).toEqual([])
    const expectedOrigin = expect.objectContaining({ rule_department_id: scopeOnly ? team : ruleDepartment, affiliation_department_id: team, role_id: role })
    const expectedAudit = scopeOnly
      ? { added_sources: [], scope_changes: [expect.objectContaining({
          added_department_ids: [ruleDepartment], removed_department_ids: [],
          rule_department_id: team, affiliation_department_id: team, role_id: role,
        })] }
      : { added_sources: [expectedOrigin], scope_changes: [] }
    expect((await db.query('select user_id,command,after_state from public.automatic_role_audit_fixture')).rows).toEqual([
      expect.objectContaining({ user_id: worker, command: 'directory_department_automatic_roles', after_state: expect.objectContaining(expectedAudit) }),
    ])
    const rollbackPreview = (await db.query<{ preview: { previewId: string; summary: unknown } }>(
      'select public.preview_organization_directory_rollback_v1($1,$2,$3) as preview', [org, fresh.id, actor],
    )).rows[0].preview
    expect(rollbackPreview.summary).toMatchObject({
      members: 0, automaticRoleSourcesAdded: 0, automaticRoleSourcesRemoved: scopeOnly ? 0 : 1,
      automaticRoleScopeWidenedMembers: 0, automaticRoleScopeNarrowedMembers: scopeOnly ? 1 : 0,
      automaticRoleAffectedMembers: 1,
    })
    const rollback = await withServiceRole(db, () => db.query<{ outcome: unknown }>(
      'select public.confirm_organization_directory_rollback_v1($1,$2,$3,$4) as outcome',
      [org, fresh.id, actor, rollbackPreview.previewId],
    ))
    expect(rollback.rows[0].outcome).toMatchObject({ status: 'rolled_back' })
    expect((await db.query('select role_id from public.department_automatic_role_sources_v1($1,$2)', [org, worker])).rows)
      .toEqual(scopeOnly ? [{ role_id: role }] : [])
    expect((await db.query('select scope_id from public.user_roles where user_id = $1', [worker])).rows).toEqual([{ scope_id: team }])
    expect((await db.query('select effect from private.employee_permission_overrides where user_id = $1', [worker])).rows).toEqual([{ effect: 'ALLOW' }])
  } finally {
    await db.close()
  }
}, 25_000)

it('forecasts automatic sources for a local move and excludes the invited account', async () => {
  const db = await setup()
  try {
    const query = (user: string) => db.query<{ result: unknown }>(
      'select private.department_change_impact_v1($1,$2,array[$3::uuid],array[$4::uuid]) as result',
      [org, user, team, ruleDepartment],
    )
    expect((await query(worker)).rows[0].result).toMatchObject({
      automatic_role_sources_added: [{ affiliation_department_id: ruleDepartment, rule_department_id: ruleDepartment, role_id: role }],
      automatic_role_sources_removed: [],
    })
    expect((await query(pending)).rows[0].result).toMatchObject({
      automatic_role_sources_added: [], automatic_role_sources_removed: [],
    })
  } finally {
    await db.close()
  }
}, 25_000)

it('saves a local hierarchy edit and records the real automatic role scope changes', async () => {
  const db = await setup()
  try {
    await db.query('update private.department_automatic_role_rules set department_id = $1 where org_id = $2', [team, org])
    await db.query('update public.roles set permissions = $1 where id = $2',
      [JSON.stringify(['shipping:ledger_view', 'dept:view']), role])
    const changes = JSON.stringify({ parent_id: team })
    const save = (previousParent: string | null) => withServiceRole(db, () => db.query<{ result: unknown }>(
      'select public.admin_save_department_parent_change_v1($1,$2,$3,$4,$5) as result',
      [org, actor, ruleDepartment, changes, previousParent],
    ))
    await expect(save(team)).rejects.toMatchObject({ detail: 'DEPARTMENT_PARENT_CHANGED' })
    expect((await save(null)).rows[0].result).toMatchObject({
      department: { id: ruleDepartment, parent_id: team, depth: 1 },
    })
    expect((await db.query('select impact from private.department_parent_change_audit')).rows).toEqual([
      { impact: expect.objectContaining({
        automaticRoleAffectedMembers: 1,
        automaticRoleSourcesAdded: 0,
        automaticRoleSourcesRemoved: 0,
        automaticRoleScopeWidenedMembers: 1,
      }) },
    ])
  } finally {
    await db.close()
  }
}, 25_000)

it('forecasts provider employment changes even when all department relationships stay the same', async () => {
  const db = await setup()
  try {
    await db.query('update public.departments set parent_id = $1 where id = $2', [ruleDepartment, team])
    const query = (active: boolean) => db.query<{ result: unknown }>(`
      select private.directory_transfer_changes_v1($1, private.directory_transfer_projection_v1($1, $2)) as result
    `, [org, JSON.stringify({
      targetProvider: 'feishu',
      departmentChanges: [
        { externalId: 'team', existingDepartmentId: team, parentExternalId: 'rule-department', status: 'active' },
        { externalId: 'rule-department', existingDepartmentId: ruleDepartment, parentExternalId: null, status: 'active' },
      ],
      userDepartmentChanges: [{ userId: worker, primaryDepartmentExternalId: 'team', departmentExternalIds: ['team'], active }],
    })])
    const expectedSource = expect.objectContaining({
      role_id: role, rule_department_id: ruleDepartment, affiliation_department_id: team,
    })
    expect((await query(false)).rows[0].result).toEqual([expect.objectContaining({
      id: worker, automatic_only: true, before_ids: [team], after_ids: [team],
      impact: expect.objectContaining({ automatic_role_sources_added: [], automatic_role_sources_removed: [expectedSource] }),
    })])
    await db.query("update public.user_organizations set employment_status = 'suspended' where user_id = $1 and org_id = $2", [worker, org])
    expect((await query(true)).rows[0].result).toEqual([expect.objectContaining({
      id: worker, automatic_only: true, before_ids: [team], after_ids: [team],
      impact: expect.objectContaining({ automatic_role_sources_added: [expectedSource], automatic_role_sources_removed: [] }),
    })])
  } finally {
    await db.close()
  }
}, 25_000)
