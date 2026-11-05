import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261103090000_unified_organization_connections.sql'), 'utf8')
const sourceId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const revision = '33333333-3333-4333-8333-333333333333'

async function fixture(tenant: string, status: string) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.organization_sources (
      id uuid primary key default gen_random_uuid(), system_org_id uuid not null,
      provider text not null, external_tenant_id text not null, priority integer,
      status text, authority_scope jsonb default '{}'::jsonb, sync_mode text,
      last_error text, created_by uuid, updated_by uuid, updated_at timestamptz default now(),
      unique(system_org_id, provider, external_tenant_id)
    );
    create table public.organization_fxiaoke_connections (
      system_org_id uuid primary key, expected_ea text, revision uuid, credentials_ciphertext text,
      app_id text, api_user_id text, last_check_status text, last_checked_at timestamptz,
      preview_started_at timestamptz, last_error text, updated_by uuid, updated_at timestamptz default now()
    );
    insert into public.organization_fxiaoke_connections(system_org_id,expected_ea,revision,credentials_ciphertext,app_id,api_user_id,last_check_status,last_checked_at)
      values ('${orgId}','ones001','${revision}','encrypted-fixture','app-fixture','employee-fixture','preview_ready',now());
  `)
  await db.query(`insert into public.organization_sources(id,system_org_id,provider,external_tenant_id,priority,status,sync_mode)
    values ($1::uuid,$2::uuid,'fxiaoke',$3,100,$4,'enrichment')`, [sourceId, orgId, tenant, status])
  return db
}

describe('legacy connection import', () => {
  it.each(['disabled', 'draft'])('preserves the corpId/source identity and imports EA credentials only as an unverified draft (%s)', async status => {
    const db = await fixture('FSCID_existing', status)
    try {
      await db.exec(migration)
      expect((await db.query(`select id,external_tenant_id,status,connection_state,draft_check_status,
        effective_revision,effective_credentials_ciphertext,effective_metadata,last_verified_at,
        lifecycle_audit->0->'effectiveRevision' as audited_revision,
        lifecycle_audit->0->>'state' as audited_state from public.organization_sources`)).rows).toEqual([{
        id: sourceId, external_tenant_id: 'FSCID_existing', status,
        connection_state: status === 'disabled' ? 'disabled' : 'configured', draft_check_status: 'not_checked',
        effective_revision: null, effective_credentials_ciphertext: null, effective_metadata: {}, last_verified_at: null,
        audited_revision: null, audited_state: status === 'disabled' ? 'disabled' : 'configured',
      }])
      expect((await db.query('select count(*)::integer as n from public.organization_fxiaoke_connections')).rows).toEqual([{ n: 1 }])
    } finally { await db.close() }
  }, 15_000)

  it('rejects contradictory enterprise identifiers of the same kind', async () => {
    const db = await fixture('another-enterprise-ea', 'disabled')
    try { await expect(db.exec(migration)).rejects.toThrow('enterprise does not match') }
    finally { await db.close() }
  }, 15_000)
})
