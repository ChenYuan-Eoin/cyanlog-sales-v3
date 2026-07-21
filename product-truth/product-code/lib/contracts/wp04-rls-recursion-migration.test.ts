import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721234000_wp04_repair_release_invariants.sql'),
  'utf8',
)
const sourceIngestionMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260721194500_wp04_contract_source_ingestion.sql'),
  'utf8',
)
const previewCanary = readFileSync(
  join(process.cwd(), 'lib/contracts/canaries/wp04-release-invariants-canary.sql'),
  'utf8',
)

function policyBody(policyName: string, tableName: string): string {
  const start = migration.indexOf(`create policy "${policyName}" on public.${tableName}`)
  const end = migration.indexOf(';', start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end + 1)
}

describe('WP04 RLS recursion repair migration', () => {
  it('uses a non-exposed active-user organization helper with a fixed search path', () => {
    expect(migration).toContain('create schema if not exists private;')
    expect(migration).toContain('create or replace function private.current_user_org_id()')
    expect(migration).toContain('security definer\nset search_path = \'\'')
    expect(migration).toContain('from public.users as profile')
    expect(migration).toContain('profile.id = (select auth.uid())')
    expect(migration).toContain("profile.status = 'active'")
    expect(migration).toContain('profile.login_enabled is true')
    expect(migration).not.toMatch(/current_user_org_id\s*\([^)]*(uuid|text)/i)
  })

  it('allows only authenticated callers to execute the helper', () => {
    expect(migration).toContain('revoke all on schema private from public, anon;')
    expect(migration).toContain('grant usage on schema private to authenticated;')
    expect(migration).toMatch(
      /revoke all on function private\.current_user_org_id\(\)\s+from public, anon, authenticated, service_role;/,
    )
    expect(migration).toMatch(
      /grant execute on function private\.current_user_org_id\(\)\s+to authenticated;/,
    )
    const helperGrant = migration.match(
      /grant execute on function private\.current_user_org_id\(\)[^;]+;/i,
    )?.[0]
    expect(helperGrant).toBeDefined()
    expect(helperGrant).not.toMatch(/to (public|anon|service_role);/i)
  })

  it('keeps the internal user directory server-only and exposes only the caller membership row', () => {
    const membershipPolicy = policyBody(
      'Current user reads own user_organizations',
      'user_organizations',
    )

    expect(migration).toContain('drop policy if exists "Same org reads users" on public.users;')
    expect(migration).not.toContain('create policy "Same org reads users"')
    expect(migration).toMatch(
      /revoke all privileges on table public\.users\s+from public, anon, authenticated;/,
    )
    expect(migration).not.toMatch(/grant\s+select\s+on table public\.users/i)
    expect(membershipPolicy).toContain('user_id = (select auth.uid())')
    expect(membershipPolicy).toContain('org_id = (select private.current_user_org_id())')
  })

  it('is replay-safe and grants browsers SELECT only on the owner-facing tables', () => {
    expect(migration).toContain(
      'drop policy if exists "Current user reads own user_organizations" on public.user_organizations;',
    )
    for (const tableName of [
      'user_organizations',
      'contracts',
      'contract_versions',
      'contract_reviews',
      'contract_analysis_jobs',
    ]) {
      expect(migration).toContain(`revoke all privileges on table public.${tableName}`)
      expect(migration).toContain(`grant select on table public.${tableName}`)
    }
    expect(migration).not.toMatch(
      /grant\s+(insert|update|delete|truncate|references|trigger|all)[\s\S]*?to authenticated/i,
    )
  })

  it.each([
    ['contracts', 'Owner reads contracts'],
    ['contract_versions', 'Owner reads contract_versions'],
    ['contract_reviews', 'Owner reads contract_reviews'],
    ['contract_analysis_jobs', 'Owner reads contract_analysis_jobs'],
  ])('keeps %s browser reads owner-only', (tableName, policyName) => {
    const body = policyBody(policyName, tableName)
    expect(body).toContain('to authenticated')
    expect(body).toContain('(select auth.uid())')
    expect(body).toContain('(select private.current_user_org_id())')
    expect(body).not.toMatch(/same org|user_organizations/i)
  })

  it('keeps source page maps service-side with no browser SELECT surface', () => {
    expect(sourceIngestionMigration).toContain(
      'revoke all on table public.contract_source_page_maps from public, anon, authenticated;',
    )
    expect(sourceIngestionMigration).toContain(
      'grant select, insert, update, delete on table public.contract_source_page_maps to service_role;',
    )
    expect(migration).not.toMatch(
      /grant[^;]*contract_source_page_maps[^;]*to authenticated;/i,
    )
    expect(migration).not.toMatch(
      /create policy[^;]*on public\.contract_source_page_maps/i,
    )
  })

  it('covers the owner, tenant, disabled-user, ACL and service-role matrix', () => {
    for (const role of ['authenticated', 'anon', 'service_role']) {
      expect(previewCanary).toContain(`set local role ${role};`)
    }
    expect(previewCanary).toContain('same-org non-owner can read an owner-only contract row')
    expect(previewCanary).toContain('other-organization user can read an owner-only contract row')
    expect(previewCanary).toContain('inactive user received an organization identity')
    expect(previewCanary).toContain('login-disabled user received an organization identity')
    expect(previewCanary).toContain('anonymous contract SELECT unexpectedly succeeded')
    expect(previewCanary).toContain('authenticated can read the internal user directory or password_hash')
    expect(previewCanary).toContain('service_role cannot read the complete source/review chain')
    expect(previewCanary.trimEnd()).toMatch(/rollback;$/)
  })

  it('catches expected page-map permission errors without swallowing an allowed SELECT', () => {
    const denialBlocks = previewCanary.match(
      /begin\s+perform 1 from public\.contract_source_page_maps[\s\S]*?when insufficient_privilege then null;\s+end;/g,
    ) ?? []

    expect(denialBlocks).toHaveLength(1)
    for (const block of denialBlocks) {
      expect(block).toContain("using errcode = 'P0001'")
    }
    expect(previewCanary).toContain("'browser_page_map_select', false")
    expect(previewCanary).toContain("'browser_password_hash_select', false")
  })
})
