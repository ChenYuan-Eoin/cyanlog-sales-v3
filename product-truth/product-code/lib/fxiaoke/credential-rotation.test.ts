// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { productionSchemaDatabase, type OrganizationTestDatabase } from '@/lib/organization-connections/schema-baseline/database'
import { preservesDirectoryCoverage } from './credential-rotation'

const org = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const member = '33333333-3333-4333-8333-333333333333'
const source = '44444444-4444-4444-8444-444444444444'
const effective = '55555555-5555-4555-8555-555555555555'
const draft = '66666666-6666-4666-8666-666666666666'
const adminRole = '77777777-7777-4777-8777-777777777777'
const tokenHash = 'a'.repeat(64)
const migration = readFileSync('supabase/migrations/20261127165000_fxiaoke_credential_rotation.sql', 'utf8')

const directory: Parameters<typeof preservesDirectoryCoverage>[0] = {
  checkedAt: '', complete: true, scopeVerified: false, scopeEvidence: null,
  departments: [{ id: 'd', name: 'Department', parentId: null, status: 'active' }],
  employees: [{ id: '1', name: 'Employee', primaryDepartmentId: 'd', departmentIds: ['d', 'other'], status: 'active',
    loginDisabled: false, employeeNumber: null, email: null, phone: null }],
  warnings: [],
}

describe('Fxiaoke credential replacement directory continuity', () => {
  it('compares canonical people, departments and relationships without claiming global scope evidence', () => {
    expect(preservesDirectoryCoverage(directory, {
      ...directory, employees: [{ ...directory.employees[0], departmentIds: ['other', 'd'] }],
    })).toBe(true)
    expect(preservesDirectoryCoverage(directory, { ...directory, employees: [] })).toBe(false)
    expect(preservesDirectoryCoverage(directory, { ...directory, complete: false })).toBe(false)
    expect(preservesDirectoryCoverage(directory, {
      ...directory, employees: [{ ...directory.employees[0], departmentIds: ['d'] }],
    })).toBe(false)
    expect(preservesDirectoryCoverage(directory, {
      ...directory, departments: [{ ...directory.departments[0], parentId: 'other' }],
    })).toBe(false)
  })
})

describe('Fxiaoke credential replacement transaction', () => {
  let db: OrganizationTestDatabase
  beforeAll(async () => {
    db = await productionSchemaDatabase()
    await db.exec(migration)
    await db.exec(`
      insert into public.organizations(id,name,status) values ('${org}','Directory proof fixture','active');
      insert into public.roles(id,code,name,permissions) values ('${adminRole}','SUPER_ADMIN','Super admin','[]');
      insert into public.users(id,org_id,display_name,status,login_enabled) values
        ('${actor}','${org}','Administrator','active',true),
        ('${member}','${org}','Employee','active',true);
      insert into public.user_organizations(membership_id,user_id,org_id,status,employment_status,is_default) values
        (gen_random_uuid(),'${actor}','${org}','active','active',true),
        (gen_random_uuid(),'${member}','${org}','active','active',true);
      insert into public.user_roles(user_id,role_id,org_id,scope_type,scope_id)
        values ('${actor}','${adminRole}','${org}','org','${org}');
      insert into public.organization_sources(id,system_org_id,provider,external_tenant_id,priority,status,authority_scope,sync_mode,
        configuration_revision,connection_state,effective_revision,draft_check_status,draft_checked_at,
        draft_credentials_ciphertext,draft_credential_envelope,effective_credentials_ciphertext,effective_credential_envelope)
        values ('${source}','${org}','fxiaoke','FSCID_test',1,'active','{"directory":"authoritative","identity":"authoritative"}','authoritative',
          '${draft}','verified','${effective}','preview_ready',now(),'draft-ciphertext','shared-v1','effective-ciphertext','shared-v1');
      insert into public.external_identities(source_id,system_org_id,external_user_id,canonical_user_id,match_status,profile_snapshot)
        values ('${source}','${org}','123','${member}','matched','{"status":"active","loginDisabled":false}');
    `)
  }, 30_000)
  afterAll(async () => { await db?.close() })

  async function createTrial(signer = actor, token = tokenHash) {
    const result = await db.query<{ result: { id: string } }>(`select public.create_fxiaoke_credential_rotation_v1(
      $1,$2,$3,$4,$5,$6,(select updated_at from public.organization_sources where id = $3),$7) result`,
    [org, signer, source, member, draft, effective, token])
    return result.rows[0].result.id
  }

  async function complete(id: string, externalUserId: string, tenant = org) {
    return (await db.query<{ ok: boolean }>('select public.complete_fxiaoke_credential_rotation_v1($1,$2,$3,$4) ok',
      [tenant, id, draft, externalUserId])).rows[0].ok
  }

  async function promote(id: string, signer = actor) {
    return (await db.query<{ ok: boolean }>('select public.promote_fxiaoke_credential_rotation_v1($1,$2,$3,$4) ok',
      [org, signer, id, draft])).rows[0].ok
  }

  it('limits verification to a current authorized superadmin and service-role RPC', async () => {
    const gates = await db.query(`select
      has_function_privilege('anon','public.resolve_fxiaoke_credential_rotation_v1(text)','EXECUTE') as anon,
      has_function_privilege('authenticated','public.promote_fxiaoke_credential_rotation_v1(uuid,uuid,uuid,uuid)','EXECUTE') as authenticated,
      has_function_privilege('service_role','public.complete_fxiaoke_credential_rotation_v1(uuid,uuid,uuid,text)','EXECUTE') as service`)
    expect(gates.rows[0]).toEqual({ anon: false, authenticated: false, service: true })
    await expect(createTrial(member)).rejects.toMatchObject({ code: '42501' })
  })

  it('isolates trial verification and atomically consumes only a current proof for the selected employee', async () => {
    const first = await createTrial()
    expect(await promote(first)).toBe(false)
    expect(await complete(first, 'foreign')).toBe(false)
    expect(await complete(first, '123', source)).toBe(false)
    await db.exec('update public.organization_sources set updated_at = updated_at + interval \'10 seconds\'')
    expect(await complete(first, '123')).toBe(false)

    const supersededProof = await createTrial(actor, 'b'.repeat(64))
    expect(await complete(supersededProof, '123')).toBe(true)
    await db.exec("update public.organization_sources set updated_at = updated_at + interval '10 seconds'")
    expect(await promote(supersededProof)).toBe(false)

    const expired = await createTrial(actor, 'c'.repeat(64))
    await db.query("update private.fxiaoke_credential_rotation_trials set expires_at = now() - interval '1 minute' where trial_id = $1", [expired])
    expect(await complete(expired, '123')).toBe(false)
    expect(await promote(expired)).toBe(false)

    const trial = await createTrial(actor, 'd'.repeat(64))
    expect(await complete(first, '123')).toBe(false)
    expect(await complete(trial, '123')).toBe(true)
    expect(await complete(trial, '123')).toBe(false)
    await expect(promote(trial, member)).rejects.toMatchObject({ code: '42501' })
    expect((await db.query('select effective_revision from public.organization_sources')).rows[0]).toEqual({ effective_revision: effective })

    expect(await promote(trial)).toBe(true)
    expect(await promote(trial)).toBe(false)
    expect((await db.query(`select effective_revision, previous_effective_revision, effective_credentials_ciphertext,
      previous_effective_credentials_ciphertext, authority_scope->>'identity' as identity
      from public.organization_sources`)).rows[0]).toEqual({
      effective_revision: draft, previous_effective_revision: effective,
      effective_credentials_ciphertext: 'draft-ciphertext', previous_effective_credentials_ciphertext: 'effective-ciphertext',
      identity: 'authoritative',
    })
  })
})
