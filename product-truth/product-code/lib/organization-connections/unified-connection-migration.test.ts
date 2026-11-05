import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { productionSchemaDatabase } from './schema-baseline/database'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261103090000_unified_organization_connections.sql'), 'utf8')
const sourceId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const revision = '33333333-3333-4333-8333-333333333333'

async function fixture(tenant: string, status: string) {
  const db = await productionSchemaDatabase()
  await db.exec(`
    insert into public.organizations(id,name) values ('${orgId}','Test organization');
    insert into public.users(id,org_id,display_name) values ('${sourceId}','${orgId}','Test operator');
    insert into public.organization_fxiaoke_connections(system_org_id,expected_ea,revision,credentials_ciphertext,app_id,api_user_id,last_check_status,last_checked_at,updated_by)
      values ('${orgId}','ones001','${revision}','v1.encrypted-fixture','app-fixture','employee-fixture','preview_ready',now(),'${sourceId}');
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
