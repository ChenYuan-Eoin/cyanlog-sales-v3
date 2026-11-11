import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { productionSchemaDatabase } from './schema-baseline/database'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261111000000_fxiaoke_sso_without_invitation.sql'), 'utf8')
const personnelMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20261021000006_personnel_lifecycle_commands.sql'), 'utf8')
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'
const source = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const adminRole = '55555555-5555-4555-8555-555555555555'
const salesRole = '66666666-6666-4666-8666-666666666666'
const sessionId = '12121212-1212-4212-8212-121212121212'

describe('Fxiaoke SSO without local invitation', () => {
  it('activates a matched member on first OAuth login without a role or invitation, then audits and revokes sessions', async () => {
    const db = await productionSchemaDatabase()
    try {
      await db.exec(personnelMigration)
      await db.exec(`create table public.auth_tokens (
        id uuid primary key default gen_random_uuid(), token text not null,
        user_id uuid not null references public.users(id), expires_at timestamptz not null
      )`)
      await db.exec(migration)
      await db.exec(`
        insert into public.organizations(id, name) values ('${org}', 'Test organization');
        insert into public.roles(id, code, name, permissions) values
          ('${adminRole}', 'SUPER_ADMIN', 'Super admin', '[]'::jsonb),
          ('${salesRole}', 'SALES', 'Sales', '[]'::jsonb);
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

      const noRole = await db.query<{ accepted: boolean }>(`
        select public.admin_replace_org_roles_v1('${actor}', '${org}', '${member}', array[]::uuid[]) as accepted
      `)
      expect(noRole.rows[0].accepted).toBe(false)
      await db.exec(`update public.external_identities
        set profile_snapshot = jsonb_set(profile_snapshot, '{status}', '"inactive"'::jsonb)
        where source_id = '${source}' and canonical_user_id = '${member}'`)
      const inactive = await db.query<{ accepted: boolean }>(`
        select public.admin_replace_org_roles_v1('${actor}', '${org}', '${member}', array['${salesRole}']::uuid[]) as accepted
      `)
      expect(inactive.rows[0].accepted).toBe(false)
      const inactiveLogin = await db.query<{ id: string | null }>(`
        select public.activate_fxiaoke_sso_member_v1('${org}', 'employee-1', '${member}') as id
      `)
      expect(inactiveLogin.rows[0].id).toBeNull()
      await db.exec(`update public.external_identities
        set profile_snapshot = jsonb_set(profile_snapshot, '{status}', '"active"'::jsonb)
        where source_id = '${source}' and canonical_user_id = '${member}'`)
      const before = await db.query<{ enabled: boolean; status: string }>(`
        select login_enabled as enabled, status from public.users where id = '${member}'
      `)
      expect(before.rows[0]).toMatchObject({ enabled: false, status: 'inactive' })
      const prematureRole = await db.query<{ accepted: boolean }>(`
        select public.admin_replace_org_roles_v1('${actor}', '${org}', '${member}', array['${salesRole}']::uuid[]) as accepted
      `)
      expect(prematureRole.rows[0].accepted).toBe(false)
      const closedLogin = await db.query<{ id: string | null }>(`
        select public.activate_fxiaoke_sso_member_v1('${org}', 'employee-1', '${member}') as id
      `)
      expect(closedLogin.rows[0].id).toBeNull()

      const enabledWithoutRole = await db.query<{ accepted: boolean }>(`
        select public.set_fxiaoke_identity_authority_v1('${actor}', '${org}', '${revision}', true) as accepted
      `)
      expect(enabledWithoutRole.rows[0].accepted).toBe(true)
      const wrongUser = await db.query<{ id: string | null }>(`
        select public.activate_fxiaoke_sso_member_v1('${org}', 'employee-1', '${actor}') as id
      `)
      expect(wrongUser.rows[0].id).toBeNull()
      const firstLogin = await db.query<{ id: string | null }>(`
        select public.activate_fxiaoke_sso_member_v1('${org}', 'employee-1', '${member}') as id
      `)
      expect(firstLogin.rows[0].id).toBe(member)
      const roleless = await db.query<{ roles: number; invitations: number; enabled: boolean }>(`
        select login_enabled as enabled,
          (select count(*)::int from public.user_roles where user_id = '${member}') as roles,
          (select count(*)::int from public.personnel_invitations where user_id = '${member}') as invitations
        from public.users where id = '${member}'
      `)
      expect(roleless.rows[0]).toMatchObject({ enabled: true, roles: 0, invitations: 0 })
      await db.exec(`update public.users set status = 'inactive', login_enabled = false where id = '${member}'`)
      const manuallyStopped = await db.query<{ id: string | null }>(`
        select public.activate_fxiaoke_sso_member_v1('${org}', 'employee-1', '${member}') as id
      `)
      expect(manuallyStopped.rows[0].id).toBeNull()
      await db.exec(`update public.users set status = 'active', login_enabled = true where id = '${member}'`)
      const beforeSession = await db.query<{ accepted: boolean }>(`
        select public.record_fxiaoke_sso_login_v1('${org}', '${member}', 'employee-1', '${sessionId}') as accepted
      `)
      expect(beforeSession.rows[0].accepted).toBe(false)

      const assigned = await db.query<{ accepted: boolean }>(`
        select public.admin_replace_org_roles_v1('${actor}', '${org}', '${member}', array['${salesRole}']::uuid[]) as accepted
      `)
      expect(assigned.rows[0].accepted).toBe(true)
      const state = await db.query<{ user_status: string; enabled: boolean; member_status: string; roles: number; invitations: number }>(`
        select person.status as user_status, person.login_enabled as enabled,
          membership.status as member_status,
          (select count(*)::int from public.user_roles where user_id = '${member}') as roles,
          (select count(*)::int from public.personnel_invitations where user_id = '${member}') as invitations
        from public.users person join public.user_organizations membership on membership.user_id = person.id
        where person.id = '${member}' and membership.org_id = '${org}'
      `)
      expect(state.rows[0]).toMatchObject({ user_status: 'active', enabled: true, member_status: 'active', roles: 1, invitations: 0 })

      const staleRevision = await db.query<{ accepted: boolean }>(`
        select public.set_fxiaoke_identity_authority_v1('${actor}', '${org}', '99999999-9999-4999-8999-999999999999', true) as accepted
      `)
      expect(staleRevision.rows[0].accepted).toBe(false)

      await db.exec(`insert into public.auth_tokens(id, token, user_id, auth_method, expires_at) values
        ('${sessionId}', 'existing-sso-session', '${member}', 'fxiaoke', now() + interval '1 hour'),
        ('13131313-1313-4313-8313-131313131313', 'existing-local-session', '${member}', 'local', now() + interval '1 hour')`)
      await db.exec(`update public.users set status = 'inactive', login_enabled = false where id = '${member}'`)
      const stoppedDuringIssue = await db.query<{ accepted: boolean }>(`
        select public.record_fxiaoke_sso_login_v1('${org}', '${member}', 'employee-1', '${sessionId}') as accepted
      `)
      expect(stoppedDuringIssue.rows[0].accepted).toBe(false)
      await db.exec(`update public.users set status = 'active', login_enabled = true where id = '${member}'`)
      const recorded = await db.query<{ accepted: boolean }>(`
        select public.record_fxiaoke_sso_login_v1('${org}', '${member}', 'employee-1', '${sessionId}') as accepted
      `)
      expect(recorded.rows[0].accepted).toBe(true)
      const audit = await db.query<{ last_login_at: string | null; successes: number }>(`
        select last_login_at,
          (select count(*)::int from public.personnel_lifecycle_events
            where target_user_id = '${member}' and command = 'fxiaoke_sso_login_success') as successes
        from public.users where id = '${member}'
      `)
      expect(audit.rows[0].last_login_at).not.toBeNull()
      expect(audit.rows[0].successes).toBe(1)
      const replay = await db.query<{ accepted: boolean }>(`
        select public.record_fxiaoke_sso_login_v1('${org}', '${member}', 'employee-1', '${sessionId}') as accepted
      `)
      expect(replay.rows[0].accepted).toBe(true)
      const count = await db.query<{ successes: number }>(`
        select count(*)::int as successes from public.personnel_lifecycle_events
        where target_user_id = '${member}' and command = 'fxiaoke_sso_login_success'
      `)
      expect(count.rows[0].successes).toBe(1)
      await db.exec(`delete from public.external_identities where source_id = '${source}' and canonical_user_id = '${member}'`)
      const disabled = await db.query<{ accepted: boolean }>(`
        select public.set_fxiaoke_identity_authority_v1('${actor}', '${org}', '${revision}', false) as accepted
      `)
      expect(disabled.rows[0].accepted).toBe(true)
      const after = await db.query<{ identity_authority: string; sso_tokens: number; local_tokens: number }>(`
        select authority_scope->>'identity' as identity_authority,
          (select count(*)::int from public.auth_tokens where user_id = '${member}' and auth_method = 'fxiaoke') as sso_tokens,
          (select count(*)::int from public.auth_tokens where user_id = '${member}' and auth_method = 'local') as local_tokens
        from public.organization_sources where id = '${source}'
      `)
      expect(after.rows[0]).toMatchObject({ identity_authority: 'evidence', sso_tokens: 0, local_tokens: 1 })
      await db.exec(`insert into public.external_identities(source_id, system_org_id, external_user_id,
        canonical_user_id, match_status, profile_snapshot)
        values ('${source}', '${org}', 'employee-1', '${member}', 'matched',
          '{"provisionedMemberId":"${member}","status":"active","loginDisabled":false}'::jsonb)`)
      const afterDisable = await db.query<{ id: string | null }>(`
        select public.activate_fxiaoke_sso_member_v1('${org}', 'employee-1', '${member}') as id
      `)
      expect(afterDisable.rows[0].id).toBeNull()
    } finally {
      await db.close()
    }
  }, 30_000)
})
