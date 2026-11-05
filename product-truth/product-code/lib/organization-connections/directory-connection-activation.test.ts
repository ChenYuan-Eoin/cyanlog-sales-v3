// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { productionSchemaDatabase, type OrganizationTestDatabase } from './schema-baseline/database'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('./storage', () => ({ assertUnifiedConnectionStorage: vi.fn(), detectConnectionStorageMode: vi.fn(async () => 'unified') }))
import { activateDirectoryConnection, loadOrganizationConnection, loadVerifiedConnection } from './service'
import { loadOrganizationSources } from '../organization-sources'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = '11111111-1111-4111-8111-111111111111'
const sourceId = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const input = { orgId: org, actorId: actor, provider: 'fxiaoke', configurationRevision: revision }
let db: OrganizationTestDatabase
let concurrentChange = false

// Execute the service's actual single-row update and CAS filters against the
// versioned production schema, including its constraints and triggers.
beforeAll(async () => {
  db = await productionSchemaDatabase()
  await db.exec(`insert into public.organizations(id,name) values ('${org}','Test');
    insert into public.users(id,org_id,display_name) values ('${actor}','${org}','Existing administrator');`)
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  concurrentChange = false
  await db.exec(`delete from public.organization_sources;
    insert into public.organization_sources(id,system_org_id,provider,external_tenant_id,priority,status,
      authority_scope,sync_mode,configuration_revision,draft_credentials_ciphertext,draft_credential_envelope,
      draft_metadata,draft_check_status,draft_checked_at,connection_state)
    values ('${sourceId}','${org}','fxiaoke','tenant',100,'disabled',
      '{"identity":"authoritative","directory":"authoritative"}','enrichment','${revision}',
      'encrypted-test-fixture','shared-v1','{"expectedEa":"tenant"}','preview_ready',now(),'disabled');`)
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'organization_sources') throw new Error(`Unexpected write/read: ${table}`)
    let patch: Record<string, unknown> | null = null
    const filters: Array<[string, unknown]> = []
    const execute = async (single: boolean) => {
      if (concurrentChange && patch) {
        await db.exec(`update public.organization_sources set updated_at=updated_at+interval '1 second' where id='${sourceId}'`)
      }
      const entries = patch ? Object.entries(patch) : []
      const values = [...entries.map(([, value]) => value), ...filters.map(([, value]) => value)]
        .map(value => value && typeof value === 'object' ? JSON.stringify(value) : value)
      const where = filters.map(([key], i) => `"${key}"=$${entries.length + i + 1}`).join(' and ')
      const sql = patch
        ? `update public.organization_sources s set ${entries.map(([key], i) => `"${key}"=$${i + 1}`).join(',')} where ${where} returning to_jsonb(s) as row`
        : `select to_jsonb(s) as row from public.organization_sources s where ${where}`
      try {
        const result = await db.query<{ row: Record<string, unknown> }>(sql, values)
        return { data: single ? result.rows[0]?.row || null : result.rows.map(r => r.row), error: null }
      } catch (error) { return { data: null, error } }
    }
    const query = {
      select: () => query,
      order: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      update: (value: Record<string, unknown>) => { patch = value; return query },
      maybeSingle: () => execute(true),
      then: (resolve: (value: unknown) => unknown) => execute(false).then(resolve),
    }
    return query
  })
})

describe('directory connection activation against production DDL', () => {
  it('projects configured and effective versions consistently without exposing stored credentials', async () => {
    expect(await loadOrganizationSources(org)).toEqual([expect.objectContaining({
      id: sourceId, connectionConfigured: true, connectionRevision: revision,
      effectiveConnectionRevision: null, connectionState: 'disabled', draftCheckStatus: 'preview_ready',
    })])
    await activateDirectoryConnection(input)
    const enabled = await loadOrganizationSources(org)
    expect(enabled).toEqual([expect.objectContaining({
      effectiveConnectionRevision: revision, connectionRevision: revision, connectionState: 'verified', status: 'active',
    })])
    expect(JSON.stringify(enabled)).not.toContain('encrypted-test-fixture')
    await db.exec(`update public.organization_sources set configuration_revision='55555555-5555-4555-8555-555555555555',
      draft_check_status='not_checked' where id='${sourceId}'`)
    expect(await loadOrganizationSources(org)).toEqual([expect.objectContaining({
      effectiveConnectionRevision: revision, connectionRevision: '55555555-5555-4555-8555-555555555555',
      draftCheckStatus: 'not_checked', connectionState: 'verified',
    })])
  })

  it('persists a disabled verified draft as a usable directory connection without enabling dormant login authority', async () => {
    const saved = await activateDirectoryConnection(input)
    expect(saved).toMatchObject({ state: 'verified', effectiveVerified: true, effectiveRevision: revision })
    expect(JSON.stringify(saved)).not.toContain('encrypted-test-fixture')
    expect(await loadOrganizationConnection(org, 'fxiaoke')).toMatchObject(saved)
    const row = (await db.query<{ status: string; identity: string; effective: string }>(`
      select status,authority_scope->>'identity' as identity,effective_credentials_ciphertext as effective
      from public.organization_sources where id='${sourceId}'`)).rows[0]
    expect(row).toEqual({ status: 'active', identity: 'evidence', effective: 'encrypted-test-fixture' })
    expect((await db.query<{ n: number }>('select count(*)::integer n from public.users')).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>('select count(*)::integer n from public.user_roles')).rows[0].n).toBe(0)
    await activateDirectoryConnection(input)
    expect((await db.query<{ n: number }>('select jsonb_array_length(lifecycle_audit) n from public.organization_sources')).rows[0].n).toBe(1)
  })

  it('preserves an already effective identity capability when applying a new directory configuration', async () => {
    await db.exec(`update public.organization_sources set status='active',connection_state='verified',
      effective_revision='55555555-5555-4555-8555-555555555555',effective_credentials_ciphertext='old',effective_credential_envelope='shared-v1'`)
    await activateDirectoryConnection(input)
    expect((await db.query<{ identity: string }>("select authority_scope->>'identity' as identity from public.organization_sources")).rows[0].identity).toBe('authoritative')
  })

  it.each(['not_checked', 'failed'])('rejects %s drafts without changing effective data', async status => {
    await db.query('update public.organization_sources set draft_check_status=$1', [status])
    await expect(activateDirectoryConnection(input)).rejects.toMatchObject({ code: 'CONNECTION_NOT_VERIFIED' })
    expect((await db.query<{ effective_revision: null }>('select effective_revision from public.organization_sources')).rows[0].effective_revision).toBeNull()
  })

  it('rejects stale revisions and concurrent source changes without partial credential promotion', async () => {
    await expect(activateDirectoryConnection({ ...input, configurationRevision: 'stale' })).rejects.toMatchObject({ code: 'CONFIG_CHANGED' })
    concurrentChange = true
    await expect(activateDirectoryConnection(input)).rejects.toMatchObject({ code: 'CONFIG_CHANGED' })
    expect((await db.query<{ status: string; effective_revision: null }>('select status,effective_revision from public.organization_sources')).rows[0])
      .toEqual({ status: 'disabled', effective_revision: null })
  })

  it('keeps disabled connections unavailable to runtime synchronization', async () => {
    await expect(loadVerifiedConnection({ orgId: org, provider: 'fxiaoke', sourceId })).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' })
  })
})
