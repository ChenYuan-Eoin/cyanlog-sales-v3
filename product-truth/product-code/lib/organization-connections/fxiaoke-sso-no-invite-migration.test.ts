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

describe('Fxiaoke SSO without local invitation', () => {
  it('promotes only a role-authorized active directory person, then opens and closes SSO with session revocation', async () => {
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
      await db.exec(`update public.external_identities
        set profile_snapshot = jsonb_set(profile_snapshot, '{status}', '"active"'::jsonb)
        where source_id = '${source}' and canonical_user_id = '${member}'`)
      const before = await db.query<{ enabled: boolean; status: string }>(`
        select login_enabled as enabled, status from public.users where id = '${member}'
      `)
      expect(before.rows[0]).toMatchObject({ enabled: false, status: 'inactive' })

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

      const enabled = await db.query<{ accepted: boolean }>(`
        select public.set_fxiaoke_identity_authority_v1('${actor}', '${org}', '${revision}', true) as accepted
      `)
      expect(enabled.rows[0].accepted).toBe(true)
      await db.exec(`insert into public.auth_tokens(token, user_id, auth_method, expires_at) values
        ('existing-sso-session', '${member}', 'fxiaoke', now() + interval '1 hour'),
        ('existing-local-session', '${member}', 'local', now() + interval '1 hour')`)
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
    } finally {
      await db.close()
    }
  }, 30_000)
})
