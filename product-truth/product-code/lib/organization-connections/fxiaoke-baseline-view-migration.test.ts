import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { productionSchemaDatabase } from './schema-baseline/database'

const migration = (name: string) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'
const source = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const adminRole = '55555555-5555-4555-8555-555555555555'

describe('Fxiaoke baseline viewing role', () => {
  it('grants only the checked read-only role once to an eligible member and denies stopped identities', async () => {
    const db = await productionSchemaDatabase()
    try {
      await db.exec(migration('20261021000006_personnel_lifecycle_commands.sql'))
      await db.exec(`create table public.auth_tokens (
        id uuid primary key default gen_random_uuid(), token text not null,
        user_id uuid not null references public.users(id), expires_at timestamptz not null
      )`)
      await db.exec(migration('20261111000000_fxiaoke_sso_without_invitation.sql'))
      await db.exec(migration('20261112000000_fxiaoke_baseline_view.sql'))
      await db.exec(migration('20261112000001_fxiaoke_baseline_scoped_role_guard.sql'))
      await db.exec(`
        insert into public.organizations(id, name) values ('${org}', 'Test organization');
        insert into public.roles(id, code, name, permissions) values
          ('${adminRole}', 'SUPER_ADMIN', 'Super admin', '[]'::jsonb);
        insert into public.users(id, org_id, display_name, status, login_enabled, password_hash) values
          ('${actor}', '${org}', 'Administrator', 'active', true, 'existing-hash'),
          ('${member}', '${org}', 'Directory person', 'inactive', false, null);
        insert into public.user_organizations(membership_id, user_id, org_id, status, employment_status, is_default) values
          ('77777777-7777-4777-8777-777777777777', '${actor}', '${org}', 'active', 'active', true),
          ('88888888-8888-4888-8888-888888888888', '${member}', '${org}', 'invited', 'active', true);
        insert into public.user_roles(user_id, role_id, org_id, scope_type, scope_id)
          values ('${actor}', '${adminRole}', '${org}', 'org', '${org}');
        insert into public.organization_sources(id, system_org_id, provider, external_tenant_id,
          priority, status, authority_scope, sync_mode, configuration_revision,
          connection_state, effective_revision)
          values ('${source}', '${org}', 'fxiaoke', 'FSCID_test', 100, 'active',
            '{"directory":"authoritative","identity":"evidence"}'::jsonb, 'enrichment',
            '${revision}', 'verified', '${revision}');
        insert into public.external_identities(source_id, system_org_id, external_user_id,
          canonical_user_id, match_status, profile_snapshot)
          values ('${source}', '${org}', 'employee-1', '${member}', 'matched',
            '{"provisionedMemberId":"${member}","status":"active","loginDisabled":false}'::jsonb);
      `)
      const before = await db.query<{ accepted: boolean }>(`select public.ensure_fxiaoke_baseline_view_v1('${org}', 'employee-1', '${member}') as accepted`)
      expect(before.rows[0].accepted).toBe(false)
      await db.exec(`select public.set_fxiaoke_identity_authority_v1('${actor}', '${org}', '${revision}', true)`)
      const first = await db.query<{ accepted: boolean }>(`select public.ensure_fxiaoke_baseline_view_v1('${org}', 'employee-1', '${member}') as accepted`)
      expect(first.rows[0].accepted).toBe(true)
      const again = await db.query<{ accepted: boolean }>(`select public.ensure_fxiaoke_baseline_view_v1('${org}', 'employee-1', '${member}') as accepted`)
      expect(again.rows[0].accepted).toBe(true)
      const grant = await db.query<{ role: string; count: number }>(`
        select r.code as role, count(*)::int as count from public.user_roles ur
        join public.roles r on r.id = ur.role_id where ur.user_id = '${member}' group by r.code`)
      expect(grant.rows).toEqual([{ role: 'FXIAOKE_BASELINE', count: 1 }])
      const audit = await db.query<{ count: number }>(`
        select count(*)::int as count from public.personnel_lifecycle_events
        where target_user_id = '${member}' and command = 'fxiaoke_baseline_view_granted'`)
      expect(audit.rows[0].count).toBe(1)
      const scopedMember = '66666666-6666-4666-8666-666666666666'
      const scopedRole = '99999999-9999-4999-8999-999999999999'
      const department = 'aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      await db.exec(`
        insert into public.roles(id, code, name, permissions)
          values ('${scopedRole}', 'DEPARTMENT_VIEWER', 'Department viewer', '["quote:view"]'::jsonb);
        insert into public.users(id, org_id, display_name, status, login_enabled, password_hash)
          values ('${scopedMember}', '${org}', 'Scoped directory person', 'active', true, null);
        insert into public.user_organizations(membership_id, user_id, org_id, status, employment_status, is_default)
          values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${scopedMember}', '${org}', 'active', 'active', true);
        insert into public.departments(id, org_id, name, source, status)
          values ('${department}', '${org}', 'Scoped team', 'manual', 'active');
        insert into public.user_roles(user_id, role_id, org_id, scope_type, scope_id)
          values ('${scopedMember}', '${scopedRole}', '${org}', 'department', '${department}');
        insert into public.external_identities(source_id, system_org_id, external_user_id,
          canonical_user_id, match_status, profile_snapshot)
          values ('${source}', '${org}', 'employee-scoped', '${scopedMember}', 'matched',
            '{"provisionedMemberId":"${scopedMember}","status":"active","loginDisabled":false}'::jsonb);
      `)
      const scoped = await db.query<{ accepted: boolean }>(
        `select public.ensure_fxiaoke_baseline_view_v1('${org}', 'employee-scoped', '${scopedMember}') as accepted`,
      )
      expect(scoped.rows[0].accepted).toBe(true)
      const scopedRoles = await db.query<{ code: string; scope_type: string }>(`
        select r.code, ur.scope_type from public.user_roles ur join public.roles r on r.id = ur.role_id
        where ur.user_id = '${scopedMember}'`)
      expect(scopedRoles.rows).toEqual([{ code: 'DEPARTMENT_VIEWER', scope_type: 'department' }])
      await db.exec(`update public.external_identities set profile_snapshot = jsonb_set(profile_snapshot, '{status}', '"inactive"'::jsonb) where source_id = '${source}'`)
      const stopped = await db.query<{ accepted: boolean }>(`select public.ensure_fxiaoke_baseline_view_v1('${org}', 'employee-1', '${member}') as accepted`)
      expect(stopped.rows[0].accepted).toBe(false)
    } finally {
      await db.close()
    }
  }, 30_000)
})
