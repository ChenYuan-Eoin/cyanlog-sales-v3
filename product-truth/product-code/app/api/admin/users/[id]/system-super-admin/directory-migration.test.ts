// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  connectionMigration, directoryMigration, preCutoverBaseline, productionSchemaDatabase, type OrganizationTestDatabase,
} from '@/lib/organization-connections/schema-baseline/database'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function migration(file: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8')
}

// These two tables are used by identity merge and sit outside the captured directory schema.
function tableDefinition(file: string, table: string) {
  const definition = migration(file).match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(.*?\\n\\);`, 's'))?.[0]
  if (!definition) throw new Error(`Missing migration definition for ${table}`)
  return definition
}

const organization = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrganization = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const administrator = '11111111-1111-4111-8111-111111111111'
const backup = '22222222-2222-4222-8222-222222222222'
const target = '33333333-3333-4333-8333-333333333333'
const source = '44444444-4444-4444-8444-444444444444'
const previousSource = '55555555-5555-4555-8555-555555555555'
const revision = '66666666-6666-4666-8666-666666666666'
const planId = '77777777-7777-4777-8777-777777777777'
const canonicalRole = '88888888-8888-4888-8888-888888888888'

const lastAdministrator = { code: '23514', detail: 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED' }
const applySql = 'select public.apply_organization_directory_cutover_v1($1,$2,$3,$4,$5,$6) as result'
const rollbackSql = 'select public.rollback_organization_directory_cutover_v1($1,$2,$3) as result'
const mergeSql = 'select public.admin_merge_duplicate_identity_v1($1,$2,$3,$4,$5) as result'

async function database() {
  const db = await productionSchemaDatabase(preCutoverBaseline)
  try {
    await db.exec(tableDefinition('20260602000001_org_model.sql', 'auth_tokens'))
    await db.exec(tableDefinition('20260606000002_add_memory_tables.sql', 'user_profiles'))
    for (const sql of [
      migration('20261021000006_personnel_lifecycle_commands.sql'),
      migration('20261022000001_role_scope_lifecycle.sql'),
      migration('20261022000002_remove_tenant_membership.sql'),
      migration('20261030100000_merge_duplicate_identity.sql'),
      connectionMigration,
      directoryMigration,
      migration('20261118095000_fxiaoke_prelogin_role_assignment.sql'),
      migration('20261125051750_department_lead_access.sql'),
      migration('20261125055213_organization_super_admin.sql'),
      migration('20261126045425_system_super_admin_authority.sql'),
      migration('20261126050925_directory_system_super_admin_guard.sql'),
    ]) await db.exec(sql)
    await db.exec(`
      insert into public.organizations(id, name) values ('${organization}','Organization'), ('${otherOrganization}','Other organization');
      insert into public.users(id, org_id, display_name, status, login_enabled) values
        ('${administrator}','${organization}','Administrator','active',true),
        ('${backup}','${organization}','Backup','active',true),
        ('${target}','${organization}','Target','active',true);
      insert into public.user_organizations(membership_id,user_id,org_id,is_default,status)
        select gen_random_uuid(),id,org_id,true,'active' from public.users;
      insert into public.roles(id,code,name) values ('${canonicalRole}','SUPER_ADMIN','System administrator');
      insert into public.user_roles(user_id,org_id,role_id,scope_type,scope_id)
        values ('${administrator}','${organization}','${canonicalRole}','org','${organization}');
      insert into public.organization_sources (
        id,system_org_id,provider,external_tenant_id,priority,status,
        sync_mode,configuration_revision,connection_state,effective_revision,updated_at
      ) values
        ('${previousSource}','${organization}','feishu','old-source',1,'active','authoritative','${revision}','verified','${revision}', '2026-11-03 00:00:00+00'),
        ('${source}','${organization}','fxiaoke','FSCID_test',2,'draft','read_only','${revision}','verified','${revision}', '2026-11-03 00:00:00+00');
    `)
    return db
  } catch (error) {
    await db.close()
    throw error
  }
}

async function storePlan(db: OrganizationTestDatabase, active: boolean, actor: string) {
  const { rows: [{ state }] } = await db.query<{ state: unknown }>(
    'select private.organization_directory_state_v1($1,$2,$3::uuid[]) as state',
    [organization, source, [administrator]],
  )
  const { rows: [{ revisions }] } = await db.query<{ revisions: unknown }>(`
    select jsonb_agg(jsonb_build_object(
      'id', id, 'provider', provider, 'priority', priority, 'status', status,
      'syncMode', sync_mode, 'configurationRevision', configuration_revision,
      'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by id) as revisions
    from public.organization_sources where system_org_id = $1
  `, [organization])
  const departmentChange = {
    kind: 'added', externalId: 'operations', existingDepartmentId: null, name: '运营',
    parentExternalId: null, status: 'active',
  }
  const membershipChange = {
    userId: administrator, externalUserId: 'employee-1', departmentExternalIds: ['operations'],
    primaryDepartmentExternalId: 'operations', active,
  }
  const payload = {
    version: 'f003-directory-cutover-v2', organizationId: organization, targetProvider: 'fxiaoke', targetSourceId: source,
    targetExternalTenantId: 'FSCID_test', connectionRevision: revision, previousPrimarySourceId: previousSource,
    sourceRevisions: revisions,
    snapshot: {
      checkedAt: '2026-11-03T00:00:00.000Z', complete: true, connectionVerified: true, scopeVerified: true,
      scopeEvidence: 'provider-admin-scope-proof', directoryHash: 'a'.repeat(64), departmentCount: 1, employeeCount: 1, warnings: [],
    },
    summary: { departmentsAdded: 1, departmentsUpdated: 0, departmentsUnchanged: 0, departmentsToDeactivate: 0, identitiesAdded: 1, identitiesUpdated: 0, identitiesUnchanged: 0, conflicts: 0 },
    conflicts: [], notices: [], departmentChanges: [departmentChange], staleTargetDepartmentIds: [],
    identityChanges: [{
      ...membershipChange, kind: 'added', existingIdentityId: null, canonicalUserId: administrator,
      displayName: 'Administrator', matchMethod: 'employee_id', confidence: 1,
      profileSnapshot: {
        ...membershipChange, employeeNumber: 'E001', status: active ? 'active' : 'inactive',
      },
    }],
    userDepartmentChanges: [membershipChange],
    beforeState: state, applyable: true, planHash: 'b'.repeat(64),
  }
  await db.query(`
    insert into public.organization_directory_cutover_plans(
      id,system_org_id,target_source_id,connection_revision,previous_primary_source_id,
      directory_hash,plan_hash,plan_payload,status,created_by,created_at,expires_at
    ) values ($1,$2,$3,$4,$5,repeat('a',64),repeat('b',64),$6::jsonb,'planned',$7,now(),now() + interval '20 minutes')
  `, [planId, organization, source, revision, previousSource, payload, actor])
  return [organization, planId, payload.planHash, revision, revisions, actor]
}

describe('directory and identity safeguards for system super administrators', () => {
  let db: OrganizationTestDatabase

  beforeEach(async () => { db = await database() }, 15_000)
  afterEach(async () => { await db?.close() })

  async function setBinding(actor: string, member: string, enabled: boolean) {
    return db.query('select public.admin_set_system_super_admin_v1($1,$2,$3,$4,$5)', [
      actor, organization, member, enabled, !enabled,
    ])
  }

  async function directoryState() {
    return (await db.query(`
      select employment_status,
        (select status from public.organization_directory_cutover_plans where id = $3) as plan_status,
        (select count(*)::integer from public.organization_directory_cutover_runs where plan_id = $3) as runs,
        (select count(*)::integer from public.departments where org_id = $1 and source = 'fxiaoke') as departments
      from public.user_organizations where org_id = $1 and user_id = $2
    `, [organization, administrator, planId])).rows[0]
  }

  async function prepareMerge() {
    await db.query("update public.organization_sources set authority_scope = '{\"identity\":\"authoritative\"}' where id = $1", [previousSource])
    await db.query(`
      insert into public.external_identities(
        source_id,system_org_id,external_user_id,canonical_user_id,match_status,match_method,match_confidence,profile_snapshot
      ) values ($1,$2,'employee-primary',$3,'matched','employee_id',1,'{}')
    `, [previousSource, organization, target])
  }

  it('rolls back the whole directory application when it suspends the last controller and permits a safe retry', async () => {
    const args = await storePlan(db, false, administrator)
    await db.exec('set role service_role')
    await expect(db.query(applySql, args)).rejects.toMatchObject(lastAdministrator)
    await db.exec('reset role')
    expect(await directoryState()).toEqual({
      employment_status: 'active', plan_status: 'planned', runs: 0, departments: 0,
    })
    expect((await db.query("select authority_scope->>'directory' as directory from public.organization_sources where id = $1", [source])).rows)
      .toEqual([{ directory: null }])

    await db.exec('set role service_role')
    await setBinding(administrator, backup, true)
    const applied = await db.query<{ result: { id: string; status: string } }>(applySql, args)
    expect(applied.rows[0].result.status).toBe('applied')
    const replay = await db.query<{ result: { id: string } }>(applySql, args)
    expect(replay.rows[0].result.id).toBe(applied.rows[0].result.id)
    await db.exec('reset role')
    expect(await directoryState()).toEqual({
      employment_status: 'suspended', plan_status: 'applied', runs: 1, departments: 1,
    })
  })

  it('does not block ordinary directory work in an organization that already had no controller', async () => {
    await db.query('delete from public.user_roles where role_id = $1', [canonicalRole])
    const args = await storePlan(db, false, administrator)
    await db.exec('set role service_role')
    await db.query(applySql, args)
    await db.exec('reset role')
    expect(await directoryState()).toMatchObject({ employment_status: 'suspended', plan_status: 'applied' })
  })

  it('refuses an otherwise current rollback that would restore the last controller to suspended', async () => {
    await setBinding(administrator, backup, true)
    await db.query("update public.user_organizations set employment_status = 'suspended' where user_id = $1", [administrator])
    const args = await storePlan(db, true, backup)
    await db.exec('set role service_role')
    await db.query(applySql, args)
    await setBinding(administrator, backup, false)
    await expect(db.query(rollbackSql, [organization, planId, administrator])).rejects.toMatchObject(lastAdministrator)
    await db.exec('reset role')
    expect(await directoryState()).toEqual({
      employment_status: 'active', plan_status: 'applied', runs: 1, departments: 1,
    })
    expect((await db.query("select status from public.organization_directory_cutover_runs where plan_id = $1", [planId])).rows)
      .toEqual([{ status: 'applied' }])
  })

  it('rolls back the real merge when the primary account would not retain effective control', async () => {
    await prepareMerge()
    await db.query('update public.user_organizations set is_default = false where user_id = $1', [target])
    await db.exec('set role service_role')
    const args = [administrator, organization, target, administrator, 'Retain the authoritative identity']
    await expect(db.query(mergeSql, args)).rejects.toMatchObject(lastAdministrator)
    await db.exec('reset role')
    expect((await db.query('select user_id from public.user_roles where role_id = $1', [canonicalRole])).rows)
      .toEqual([{ user_id: administrator }])
    expect((await db.query("select count(*)::integer as count from public.personnel_lifecycle_events where command like 'merge_%'")).rows)
      .toEqual([{ count: 0 }])

    await db.query('update public.user_organizations set is_default = true where user_id = $1', [target])
    await db.exec('set role service_role')
    const merged = await db.query<{ result: { primary_user_id: string; roles_moved: number } }>(mergeSql, args)
    expect(merged.rows[0].result).toMatchObject({ primary_user_id: target, roles_moved: 1 })
    await db.exec('reset role')
    expect((await db.query('select user_id from public.user_roles where role_id = $1', [canonicalRole])).rows)
      .toEqual([{ user_id: target }])
  })

  it('protects a controller in a different default organization, while an ordinary cross-organization duplicate can merge', async () => {
    await prepareMerge()
    await db.query('update public.user_organizations set is_default = false where user_id = $1', [backup])
    await db.query("insert into public.user_organizations(membership_id,user_id,org_id,is_default,status) values (gen_random_uuid(),$1,$2,true,'active')", [backup, otherOrganization])
    await db.query("insert into public.user_roles(user_id,org_id,role_id,scope_type,scope_id) values ($1,$2,$3,'org',$2)", [backup, otherOrganization, canonicalRole])

    const args = [administrator, organization, target, backup, 'Retain the authoritative identity']
    await db.exec('set role service_role')
    await expect(db.query(mergeSql, args)).rejects.toMatchObject({ code: '23514', detail: 'OTHER_ORG_SYSTEM_SUPER_ADMIN_PROTECTED' })
    await db.exec('reset role')
    expect((await db.query('select login_enabled from public.users where id = $1', [backup])).rows)
      .toEqual([{ login_enabled: true }])
    await db.query('delete from public.user_roles where user_id = $1 and org_id = $2 and role_id = $3', [backup, otherOrganization, canonicalRole])
    await db.exec('set role service_role')
    const merged = await db.query<{ result: { primary_user_id: string } }>(mergeSql, args)
    expect(merged.rows[0].result.primary_user_id).toBe(target)
  })

  it('requires the effective actor and blocks direct execution of the retired function bodies', async () => {
    await db.query('update public.user_organizations set is_default = false where user_id = $1', [administrator])
    await db.exec('set role service_role')
    const args = [administrator, organization, target, backup, 'Retain the authoritative identity']
    await expect(db.query(mergeSql, args)).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select private.admin_merge_duplicate_identity_v1($1,$2,$3,$4,$5)', args))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select private.apply_organization_directory_cutover_v1($1,$2,$3,$4,$5,$6)', [
      organization, planId, 'b'.repeat(64), revision, [], administrator,
    ])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select private.rollback_organization_directory_cutover_v1($1,$2,$3)', [
      organization, planId, administrator,
    ])).rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role; set role authenticated')
    await expect(db.query(rollbackSql, [organization, planId, administrator])).rejects.toMatchObject({ code: '42501' })
  })
})
