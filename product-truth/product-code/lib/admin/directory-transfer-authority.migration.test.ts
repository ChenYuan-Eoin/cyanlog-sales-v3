// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { connectionMigration, preCutoverBaseline, productionSchemaDatabase } from '../organization-connections/schema-baseline/database'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = '11111111-1111-4111-8111-111111111111'
const person = '22222222-2222-4222-8222-222222222222'
const source = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const oldDepartment = '55555555-5555-4555-8555-555555555555'
const retainedDepartment = '66666666-6666-4666-8666-666666666666'
const role = '77777777-7777-4777-8777-777777777777'
const migrate = (file: string) => readFileSync('supabase/migrations/' + file, 'utf8')

it.each(['feishu', 'fxiaoke'])('binds %s apply and rollback to fresh authority without silently restoring grants', async provider => {
  const db = await productionSchemaDatabase(preCutoverBaseline)
  try {
    await db.exec(connectionMigration)
    await db.exec(migrate('20261103120000_organization_directory_cutover.sql'))
    await db.exec(`
      create table private.employee_permission_overrides (
        org_id uuid, user_id uuid, permission_code text, effect text, scope jsonb, updated_by uuid,
        updated_at timestamptz not null default now(), pending_target_revision text
      );
      create table if not exists public.fxiaoke_pending_org_roles (
        org_id uuid, user_id uuid, role_id uuid, granted_by uuid, granted_at timestamptz
      );
      create table if not exists public.department_lead_access (
        org_id uuid, user_id uuid, department_id uuid, confirmed_at timestamptz, confirmed_by uuid
      );
      create function private.shipping_role_scope_catalog_v1()
        returns table(code text,supported_scope_types text[]) language sql stable as $$
          select 'shipping:ledger_view'::text, array['org','department']::text[];
      $$;
      create function public.admin_merge_duplicate_identity_v1(uuid,uuid,uuid,uuid,text,text)
        returns jsonb language sql as $$ select '{}'::jsonb; $$;
      create function private.personnel_is_org_control_admin_v1(uuid,uuid)
        returns boolean language sql as $$ select true; $$;
      ${migrate('20261021000006_personnel_lifecycle_commands.sql').match(/create or replace function private\.personnel_lock_org_v1\([\s\S]*?\n\$\$;/)?.[0]}
    `)
    await db.exec(migrate('20261126050925_directory_system_super_admin_guard.sql'))
    await db.exec(migrate('20261127145000_department_change_authority.sql'))
    await db.exec(migrate('20261127152500_directory_transfer_authority.sql'))
    await db.exec(`
      insert into public.organizations (id,name,settings) values ('${org}','Test organization',
        '{"department_permission_grants":{"${oldDepartment}":{"permissions":["shipping:ledger_view"],"include_subdepartments":false}}}');
      insert into public.departments (id,org_id,name,source,external_id,status) values
        ('${oldDepartment}','${org}','Old','${provider}','old','active'),
        ('${retainedDepartment}','${org}','Retained','manual',null,'active');
      insert into public.users (id,org_id,display_name,primary_dept_id) values
        ('${actor}','${org}','Admin',null), ('${person}','${org}','Existing member','${oldDepartment}');
      insert into public.user_organizations (membership_id,user_id,org_id,primary_department_id) values
        (gen_random_uuid(),'${actor}','${org}',null), (gen_random_uuid(),'${person}','${org}','${oldDepartment}');
      insert into public.user_departments (user_id,department_id,org_id,source,is_primary) values
        ('${person}','${oldDepartment}','${org}','${provider}',true),
        ('${person}','${retainedDepartment}','${org}','manual',false);
      insert into public.roles(id,code,name,permissions) values ('${role}','SALES','Sales','["shipping:ledger_view"]');
      insert into public.user_roles(user_id,org_id,role_id,scope_type,scope_id) values
        ('${person}','${org}','${role}','department','${oldDepartment}'),
        ('${person}','${org}','${role}','department','${retainedDepartment}');
      insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
        values ('${org}','${person}','shipping:ledger_view','ALLOW','{"type":"org"}');
      insert into public.organization_sources(
        id,system_org_id,provider,external_tenant_id,priority,status,sync_mode,
        configuration_revision,connection_state,effective_revision
      ) values ('${source}','${org}','${provider}','tenant',1,'active','authoritative','${revision}','verified','${revision}');
    `)
    const before = (await db.query<{ state: unknown }>(
      'select private.organization_directory_state_v1($1,$2,array[$3::uuid]) as state',
      [org, source, person],
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
      departmentChanges: [{ kind: 'added', externalId: 'new', existingDepartmentId: null, name: 'New', parentExternalId: null, status: 'active' }],
      identityChanges: [{
        kind: 'added', canonicalUserId: person, externalUserId: 'employee', active: true, createsMember: false,
        departmentExternalIds: ['new'], matchMethod: 'employee_id', confidence: 1, displayName: 'Existing member',
        profileSnapshot: { primaryDepartmentExternalId: 'new', departmentExternalIds: ['new'], status: 'active' },
      }],
      userDepartmentChanges: [{
        userId: person, externalUserId: 'employee', departmentExternalIds: ['new'], primaryDepartmentExternalId: 'new', active: true,
      }],
      beforeState: before, staleTargetDepartmentIds: [],
    }
    const store = () => db.query<{ id: string; plan_hash: string; plan_payload: unknown }>(`
      select id,plan_hash,plan_payload from public.store_organization_directory_authority_plan_v1(
        $1,$2,$3,null,repeat('a',64),$4,$5,now()+interval '10 minutes')
    `, [org, source, revision, JSON.stringify(payload), actor]).then(result => result.rows[0])
    const apply = (plan: Awaited<ReturnType<typeof store>>) => db.query<{ run: unknown }>(
      'select public.apply_organization_directory_cutover_v1($1,$2,$3,$4,$5,$6) as run',
      [org, plan.id, plan.plan_hash, revision, JSON.stringify(revisions), actor],
    )

    const first = await store()
    expect(first.plan_payload).toMatchObject({ authorityReview: { summary: {
      members: 1, baselineChanges: 1, rolesForReview: 2, personalExceptions: 1,
    } } })
    await db.query('update public.roles set permissions = $1 where id = $2', [JSON.stringify(['shipping:record_return']), role])
    await expect(apply(first)).rejects.toMatchObject({ detail: 'DIRECTORY_AUTHORITY_PREVIEW_STALE' })
    const second = await store()
    expect((await apply(second)).rows[0].run).toMatchObject({ status: 'applied' })
    expect((await apply(second)).rows[0].run).toMatchObject({ status: 'applied' })
    expect((await db.query<unknown>(
      'select scope_id from public.user_roles where org_id = $1 and user_id = $2',
      [org, person],
    )).rows).toEqual([{ scope_id: retainedDepartment }])
    const during = (await db.query<unknown>(
      'select effect,scope from private.employee_permission_overrides where org_id = $1 and user_id = $2', [org, person],
    )).rows
    expect(during).toEqual([{ effect: 'DENY', scope: null }])

    const preview = () => db.query<{ preview: { previewId: string; summary: { members: number } } }>(
      'select public.preview_organization_directory_rollback_v1($1,$2,$3) as preview', [org, second.id, actor],
    ).then(result => result.rows[0].preview)
    const rollback = (previewId: string, intentActor = actor) => db.query<{ run: unknown }>(
      'select public.confirm_organization_directory_rollback_v1($1,$2,$3,$4) as run', [org, second.id, intentActor, previewId],
    )
    const rollbackPreview = await preview()
    expect(rollbackPreview.summary.members).toBe(1)
    await expect(rollback(rollbackPreview.previewId, person)).rejects.toMatchObject({ detail: 'DIRECTORY_ROLLBACK_PREVIEW_STALE' })
    await db.query('update private.employee_permission_overrides set effect=$1,scope=$2 where org_id=$3 and user_id=$4',
      ['ALLOW', JSON.stringify({ type: 'org' }), org, person])
    await expect(rollback(rollbackPreview.previewId)).rejects.toMatchObject({ detail: 'DIRECTORY_ROLLBACK_PREVIEW_STALE' })
    const renewed = await preview()
    expect((await rollback(renewed.previewId)).rows[0].run).toMatchObject({ status: 'rolled_back' })
    expect((await db.query<unknown>(
      'select department_id from public.user_departments where org_id = $1 and user_id = $2 order by department_id',
      [org, person],
    )).rows).toEqual([{ department_id: oldDepartment }, { department_id: retainedDepartment }])
    expect((await db.query<unknown>(
      'select scope_id from public.user_roles where org_id = $1 and user_id = $2',
      [org, person],
    )).rows).toEqual([{ scope_id: retainedDepartment }])
    expect((await db.query<unknown>(
      'select effect from private.employee_permission_overrides where org_id = $1 and user_id = $2',
      [org, person],
    )).rows).toEqual([{ effect: 'DENY' }])
  } finally {
    await db.close()
  }
}, 20_000)
