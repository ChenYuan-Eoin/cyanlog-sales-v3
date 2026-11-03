import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function migration(name: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
}

const sourceMigration = migration('20261021000002_organization_sources.sql')
const bindingMigration = migration('20261022000004_organization_source_bindings.sql')
const fxiaokeMigration = migration('20261027105230_fxiaoke_connection_preview.sql')
const unifiedMigration = migration('20261103090000_unified_organization_connections.sql')

const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = '11111111-1111-4111-8111-111111111111'

describe('organization sources migration chain', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.organizations (
        id uuid primary key
      );
      create table public.users (
        id uuid primary key
      );
      insert into public.organizations (id) values
        ('${orgA}'),
        ('${orgB}');
      insert into public.users (id) values
        ('${actor}');
    `)
    await db.exec(sourceMigration)
    await db.exec(bindingMigration)
    await db.exec(fxiaokeMigration)
  })

  afterEach(async () => {
    await db.close()
  })

  async function applyUnifiedMigration() {
    await db.exec(unifiedMigration)
  }

  it('enforces one active priority per tenant and source identity uniqueness', async () => {
    await applyUnifiedMigration()
    await db.query(`
      insert into public.organization_sources
        (system_org_id, provider, external_tenant_id, priority, status, sync_mode)
      values
        ('${orgA}', 'feishu', 'primary', 1, 'active', 'authoritative')
    `)

    await expect(db.query(`
      insert into public.organization_sources
        (system_org_id, provider, external_tenant_id, priority, status, sync_mode)
      values
        ('${orgA}', 'wecom', 'duplicate-priority', 1, 'active', 'enrichment')
    `)).rejects.toThrow()

    const source = await db.query<{ id: string }>(`
      select id from public.organization_sources
      where system_org_id = '${orgA}'
    `)
    await db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, '${orgA}', 'external-user-1', 'unresolved')
    `, [source.rows[0].id])

    await expect(db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, '${orgA}', 'external-user-1', 'matched')
    `, [source.rows[0].id])).rejects.toThrow()
  })

  it('rejects an identity whose source belongs to another tenant', async () => {
    await applyUnifiedMigration()
    await db.query(`
      insert into public.organization_sources
        (system_org_id, provider, external_tenant_id, priority, status, sync_mode)
      values
        ('${orgA}', 'feishu', 'primary', 1, 'active', 'authoritative')
    `)
    const source = await db.query<{ id: string }>(`
      select id from public.organization_sources
      where system_org_id = '${orgA}'
    `)

    await expect(db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, '${orgB}', 'cross-tenant-user', 'unresolved')
    `, [source.rows[0].id])).rejects.toThrow()
  })

  it('imports legacy Fxiaoke credentials into the existing source without losing ids or identities', async () => {
    const sourceId = '33333333-3333-4333-8333-333333333333'
    const revision = '44444444-4444-4444-8444-444444444444'
    await db.query(`
      insert into public.organization_sources
        (id, system_org_id, provider, external_tenant_id, priority, status, sync_mode, created_by, updated_by)
      values
        ($1, '${orgA}', 'fxiaoke', 'FSCID_legacy', 1, 'active', 'authoritative', '${actor}', '${actor}')
    `, [sourceId])
    await db.query(`
      insert into public.external_identities
        (source_id, system_org_id, external_user_id, match_status)
      values
        ($1, '${orgA}', 'legacy-employee', 'unresolved')
    `, [sourceId])
    await db.query(`
      insert into public.organization_fxiaoke_connections
        (system_org_id, app_id, expected_ea, api_user_id, credentials_ciphertext,
         revision, last_checked_at, last_check_status, updated_by)
      values
        ('${orgA}', 'FSAID_legacy', 'FSCID_legacy', '10001', 'v1.legacy-ciphertext',
         $1, '2026-10-27T00:00:00Z', 'preview_ready', '${actor}')
    `, [revision])

    await applyUnifiedMigration()

    expect((await db.query<Record<string, unknown>>(`
      select id, status, connection_state, configuration_revision, effective_revision,
             effective_credential_envelope, effective_metadata,
             draft_credentials_ciphertext, lifecycle_audit
      from public.organization_sources
      where system_org_id = '${orgA}' and provider = 'fxiaoke'
    `)).rows[0]).toMatchObject({
      id: sourceId,
      status: 'active',
      connection_state: 'verified',
      configuration_revision: revision,
      effective_revision: revision,
      effective_credential_envelope: 'legacy-fxiaoke-v1',
      effective_metadata: {
        appId: 'FSAID_legacy',
        apiUserId: '10001',
        expectedEa: 'FSCID_legacy',
      },
      draft_credentials_ciphertext: 'v1.legacy-ciphertext',
    })
    expect((await db.query<{ count: number }>(`
      select count(*)::integer as count
      from public.external_identities
      where source_id = '${sourceId}' and external_user_id = 'legacy-employee'
    `)).rows[0].count).toBe(1)
    expect((await db.query<{ count: number }>(`
      select count(*)::integer as count
      from public.organization_fxiaoke_connections
      where system_org_id = '${orgA}'
    `)).rows[0].count).toBe(1)
    expect((await db.query<{ can_update: boolean }>(`
      select has_table_privilege('service_role', 'public.organization_fxiaoke_connections', 'UPDATE') as can_update
    `)).rows[0].can_update).toBe(false)
  })

  it('allows direct binding to create only a draft or disabled source, never to activate it', async () => {
    await applyUnifiedMigration()
    const sourceId = '55555555-5555-4555-8555-555555555555'
    await db.query(`
      insert into public.organization_sources
        (id, system_org_id, provider, external_tenant_id, priority, status, sync_mode, created_by, updated_by)
      values
        ($1, '${orgA}', 'feishu', 'primary', 1, 'active', 'authoritative', '${actor}', '${actor}')
    `, [sourceId])

    await expect(db.query(`
      select * from public.bind_organization_source(
        '${orgA}', 'fxiaoke', 'FSCID_replacement', 1, 'active', 'authoritative',
        '{}'::jsonb, '${actor}'
      )
    `)).rejects.toThrow()

    const draft = await db.query<{ provider: string; status: string; connection_state: string }>(`
      select * from public.bind_organization_source(
        '${orgA}', 'fxiaoke', 'FSCID_replacement', 2, 'draft', 'read_only',
        '{}'::jsonb, '${actor}'
      )
    `)
    expect(draft.rows).toEqual([expect.objectContaining({
      provider: 'fxiaoke',
      status: 'draft',
      connection_state: 'unconfigured',
    })])
    expect((await db.query<{ provider: string; status: string }>(`
      select provider, status from public.organization_sources
      where system_org_id = '${orgA}' and priority = 1
    `)).rows).toEqual([{ provider: 'feishu', status: 'active' }])
  })
})
