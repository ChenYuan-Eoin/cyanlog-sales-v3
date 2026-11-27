// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { directoryMigration, productionSchemaDatabase, type OrganizationTestDatabase } from '@/lib/organization-connections/schema-baseline/database'

const org = '11111111-1111-4111-8111-111111111111'
const foreignOrg = '22222222-2222-4222-8222-222222222222'
const source = '33333333-3333-4333-8333-333333333333'
const member = '44444444-4444-4444-8444-444444444444'
const foreignMember = '55555555-5555-4555-8555-555555555555'
const revision = '66666666-6666-4666-8666-666666666666'
const session = '77777777-7777-4777-8777-777777777777'
const plan = '88888888-8888-4888-8888-888888888888'
const actor = '99999999-9999-4999-8999-999999999999'
const adminRole = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const externalId = '123456'
const originalOrder = 'SO-20261101-HISTORY1'
const existingMemberProfile = {
  directorySyncVersion: 'f003-directory-cutover-v2', provider: 'fxiaoke', externalUserId: externalId,
  status: 'active', loginDisabled: false,
}

function migration(name: string) {
  return readFileSync(`supabase/migrations/${name}.sql`, 'utf8')
}

describe('A01 original ICU member linked and authenticated by Fxiaoke', () => {
  let db: OrganizationTestDatabase

  beforeAll(async () => {
    db = await productionSchemaDatabase()
    await db.exec(directoryMigration)
    const installSqlFunction = async (name: string, startSql: string) => {
      const sql = migration(name)
      const start = sql.indexOf(startSql)
      const end = sql.indexOf('$$;', start)
      if (start < 0 || end < 0) throw new Error(`Production function fixture missing for ${startSql}`)
      await db.exec(sql.slice(start, end + '$$;'.length))
    }
    await installSqlFunction('20261021000006_personnel_lifecycle_commands',
      'create or replace function private.personnel_insert_event_v1(')
    await installSqlFunction('20261126111603_fxiaoke_prelogin_employee_permission_overrides',
      'create function private.employee_prelogin_target_revision_v1(')
    await db.exec('alter table private.employee_permission_overrides add column if not exists pending_target_revision text')
    await installSqlFunction('20261111000000_fxiaoke_sso_without_invitation',
      'create or replace function public.set_fxiaoke_identity_authority_v1(')
    await db.exec(migration('20261126062934_guard_fxiaoke_sso_system_authority'))
    await db.exec(migration('20260922000001_shipping_collaboration_m0'))
    await db.exec(migration('20261127165000_fxiaoke_credential_rotation'))
    await db.exec(migration('20261127170500_fxiaoke_existing_member_login'))
    await db.exec(`
      create table public.auth_tokens(
        id uuid primary key, user_id uuid not null references public.users(id),
        expires_at timestamptz not null, auth_method text not null
      );
      alter table public.shipping_orders add column org_id uuid references public.organizations(id);
      insert into public.organizations(id,name) values ('${org}','Test organization'), ('${foreignOrg}','Other organization');
      insert into public.users(id,org_id,display_name,status,login_enabled,password_hash) values
        ('${member}','${org}','Existing linked employee','active',true,'existing-test-hash'),
        ('${actor}','${org}','Administrator','active',true,'actor-test-hash'),
        ('${foreignMember}','${foreignOrg}','Other employee','active',true,'foreign-test-hash');
      insert into public.user_organizations(membership_id,user_id,org_id,status,employment_status,is_default) values
        (gen_random_uuid(),'${member}','${org}','active','active',true),
        (gen_random_uuid(),'${actor}','${org}','active','active',true),
        (gen_random_uuid(),'${foreignMember}','${foreignOrg}','active','active',true);
      insert into public.roles(id,code,name,permissions) values ('${adminRole}','SUPER_ADMIN','System admin','[]');
      insert into public.user_roles(user_id,role_id,org_id,scope_type,scope_id)
        values ('${actor}','${adminRole}','${org}','org','${org}');
      insert into public.shipping_orders(order_no,created_by,org_id,intake_source,confirmation_policy,status,assignment_status,
        shipment_payload,payload_hash,idempotency_key,receipt_token_hash,created_at)
      values ('${originalOrder}','${member}','${org}','owner_web','scheduled_review','delivered','unassigned',
        '{}','test-empty',gen_random_uuid(),'test-receipt','2026-11-01 08:00:00+08');
      insert into public.organization_sources(id,system_org_id,provider,external_tenant_id,priority,status,authority_scope,sync_mode,
        configuration_revision,connection_state,effective_revision,last_successful_sync_at) values
        ('${source}','${org}','fxiaoke','FSCID_test',1,'active','{"directory":"authoritative","identity":"authoritative"}','authoritative',
          '${revision}','verified','${revision}','2026-11-27 10:00:00+08');
      insert into public.organization_directory_cutover_plans(id,system_org_id,target_source_id,connection_revision,directory_hash,
        plan_hash,plan_payload,status,created_by,created_at,expires_at,applied_at)
      values ('${plan}','${org}','${source}','${revision}',repeat('a',64),repeat('b',64),'{}','applied','${actor}',
        '2026-11-27 09:59:00+08','2026-11-27 10:29:00+08','2026-11-27 10:00:00+08');
    `)
  }, 30_000)
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec(`
      delete from public.organization_directory_cutover_runs;
      delete from public.external_identities;
      delete from public.auth_tokens;
      delete from public.personnel_lifecycle_events;
    `)
  })

  async function activation(tenant = org, user = member, subject = externalId) {
    return (await db.query<{ id: string | null }>('select public.activate_fxiaoke_sso_member_v1($1,$2,$3) id',
      [tenant, subject, user])).rows[0].id
  }

  async function audit(tenant = org, user = member, subject = externalId) {
    return (await db.query<{ result: boolean }>('select public.record_fxiaoke_sso_login_v1($1,$2,$3,$4) result',
      [tenant, user, subject, session])).rows[0].result
  }

  async function ownedShipments(user: string) {
    return (await db.query<{ order_no: string }>(`select order_no from public.shipping_orders
      where org_id=$1 and created_by=$2 and intake_source='owner_web' order by created_at desc`, [org, user])).rows
  }

  async function setBindingWithoutRun() {
    await db.query(`insert into public.external_identities(source_id,system_org_id,external_user_id,canonical_user_id,match_status,profile_snapshot)
      values ($1,$2,$3,$4,'matched',$5::jsonb)`,
    [source, org, externalId, member, JSON.stringify(existingMemberProfile)])
  }

  async function recordAppliedBinding() {
    await db.query(`insert into public.organization_directory_cutover_runs(system_org_id,plan_id,target_source_id,status,department_count,
      identity_count,member_count,before_state,after_state,applied_by,applied_at)
      values ($1,$2,$3,'applied',0,1,0,'{}',private.organization_directory_state_v1($1,$3,array[$4]::uuid[]),$5,'2026-11-27 10:00:00+08')`,
    [org, plan, source, member, actor])
  }

  it('uses the applied stable binding to open the existing member session and keeps the prior personal shipment', async () => {
    expect(await ownedShipments(member)).toEqual([{ order_no: originalOrder }])
    expect(await activation()).toBeNull()
    await setBindingWithoutRun()
    expect(await activation()).toBeNull()
    await recordAppliedBinding()

    const authenticatedMember = await activation()
    expect(authenticatedMember).toBe(member)
    if (!authenticatedMember) throw new Error('fixture failed to authenticate the original member')
    await db.query(`insert into public.auth_tokens(id,user_id,expires_at,auth_method) values
      ($1,$2,now()+interval '1 hour','fxiaoke')`, [session, authenticatedMember])
    expect(await audit()).toBe(true)
    expect(await audit()).toBe(true)
    expect(await ownedShipments(authenticatedMember)).toEqual([{ order_no: originalOrder }])
    expect((await db.query('select count(*)::int n from public.users where org_id=$1', [org])).rows[0]).toEqual({ n: 2 })
    expect((await db.query(`select command,target_user_id from public.personnel_lifecycle_events
      where target_user_id=$1 and command like 'fxiaoke_sso_%'`, [member])).rows)
      .toEqual([{ command: 'fxiaoke_sso_login_success', target_user_id: member }])
    expect((await db.query('select count(*)::int n from public.user_roles where user_id=$1', [member])).rows[0]).toEqual({ n: 0 })
    expect((await db.query('select member_id from private.fxiaoke_rotation_eligible_members($1,$2)', [org, source])).rows)
      .toEqual([{ member_id: member }])
  })

  it('preserves first login for a legitimately provisioned pending directory employee', async () => {
    const pending = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const pendingExternalId = '654321'
    const pendingProfile = {
      ...existingMemberProfile, externalUserId: pendingExternalId, provisionedMemberId: pending,
    }
    await db.query(`insert into public.users(id,org_id,display_name,status,login_enabled)
      values ($1,$2,'Pending directory employee','inactive',false)`, [pending, org])
    await db.query(`insert into public.user_organizations(membership_id,user_id,org_id,status,employment_status,is_default)
      values (gen_random_uuid(),$1,$2,'invited','active',true)`, [pending, org])
    await db.query(`insert into public.external_identities(source_id,system_org_id,external_user_id,canonical_user_id,match_status,profile_snapshot)
      values ($1,$2,$3,$4,'matched',$5::jsonb)`, [source, org, pendingExternalId, pending, JSON.stringify(pendingProfile)])
    expect(await activation(org, pending, pendingExternalId)).toBe(pending)
    expect((await db.query('select status,login_enabled from public.users where id=$1', [pending])).rows[0])
      .toEqual({ status: 'active', login_enabled: true })
    expect((await db.query('select count(*)::int n from public.user_roles where user_id=$1', [pending])).rows[0]).toEqual({ n: 0 })
    // Reset test-only member rows so the existing-member count remains independent of test order.
    await db.query('delete from public.personnel_lifecycle_events where target_user_id=$1', [pending])
    await db.query('delete from public.external_identities where canonical_user_id=$1', [pending])
    await db.query('delete from public.user_organizations where user_id=$1', [pending])
    await db.query('delete from public.users where id=$1', [pending])
  })

  it('can reopen Fxiaoke login with only an existing linked employee and rejects no eligible member', async () => {
    const setSso = async (enabled: boolean, signer = actor) => {
      const result = await db.query<{ result: boolean }>(
        'select public.set_fxiaoke_identity_authority_v1($1,$2,$3,$4) result', [signer, org, revision, enabled])
      return result.rows[0].result
    }
    expect(await setSso(false)).toBe(true)
    expect(await setSso(true)).toBe(false)

    await setBindingWithoutRun()
    expect(await setSso(true)).toBe(false)
    await recordAppliedBinding()
    expect(await activation()).toBeNull()
    expect(await setSso(true, member)).toBe(false)
    expect(await setSso(true)).toBe(true)
    expect(await activation()).toBe(member)

    await db.query("insert into public.auth_tokens values ($1,$2,now()+interval '1 hour','fxiaoke')", [session, member])
    expect(await setSso(false)).toBe(true)
    expect(await activation()).toBeNull()
    expect((await db.query('select id from public.auth_tokens where id=$1', [session])).rows).toEqual([])
    expect(await setSso(true)).toBe(true)
  })

  it('rejects a stopped, conflicting or cross-tenant identity before accepting login or audit', async () => {
    await setBindingWithoutRun()
    await recordAppliedBinding()
    await db.query("insert into public.auth_tokens values ($1,$2,now()+interval '1 hour','fxiaoke')", [session, member])
    expect(await activation()).toBe(member)
    expect(await activation(foreignOrg, foreignMember)).toBeNull()
    expect(await activation(org, foreignMember)).toBeNull()
    expect(await audit(foreignOrg, foreignMember)).toBe(false)

    await db.query(`insert into public.external_identities(source_id,system_org_id,external_user_id,canonical_user_id,match_status)
      values ($1,$2,'other-provider-employee',$3,'conflict')`, [source, org, member])
    expect(await activation()).toBeNull()
    expect(await audit()).toBe(false)
    await db.query("delete from public.external_identities where source_id=$1 and external_user_id='other-provider-employee'", [source])
    expect(await activation()).toBe(member)

    await db.query(`update public.external_identities set profile_snapshot=jsonb_set(profile_snapshot,'{loginDisabled}','true')
      where source_id=$1`, [source])
    expect(await activation()).toBeNull()
    expect(await audit()).toBe(false)

    await db.query(`update public.external_identities set profile_snapshot=$2::jsonb, match_status='conflict' where source_id=$1`,
      [source, JSON.stringify(existingMemberProfile)])
    expect(await activation()).toBeNull()
    expect(await audit()).toBe(false)
  })
})
